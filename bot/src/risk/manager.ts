import { config } from '../config';
import { logger } from '../utils/logger';

// =============================================
// Types
// =============================================
export interface RiskLimits {
  maxPositionSize: number;  // % max du capital par trade
  maxTradeAmountUsd: number;
  maxOpenTrades: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDailyLoss: number;     // USD — arrête le bot si dépassé
  maxDrawdown: number;      // % — arrêt d'urgence
  maxDailyTrades: number;   // 🆕 Nombre max de trades par jour
  atrMultiplierSL: number;  // Multiplicateur ATR pour stop-loss dynamique
  atrMultiplierTP: number;  // Multiplicateur ATR pour take-profit dynamique
  // 🆕 Trailing stop parameters (v2.0)
  trailingActivationPct: number;  // % de gain avant d'activer le trailing (ex: 0.015 = 1.5%)
  trailingDistancePct: number;    // % sous le high pour le trailing stop (ex: 0.01 = 1.0%)
  breakEvenActivationPct: number; // % de gain pour remonter SL au breakeven (ex: 0.01 = 1.0%)
}

export interface PositionSizeResult {
  allowed: boolean;
  quantity: number;
  amountUsd: number;
  reason?: string;
}

export interface ExitLevels {
  stopLoss: number;
  takeProfit: number;
  method: 'atr' | 'fixed';
}

// =============================================
// Gestionnaire de Risques v2.0 (optimisé)
// =============================================
// Corrections majeures :
// ✅ Trailing stop réaliste (1.5% activation, 1.0% trail)
// ✅ Breakeven stop (protection du capital après +1%)
// ✅ ATR R:R amélioré (2.0 SL / 3.5 TP = 1:1.75)
// ✅ Max daily trades limit
// ✅ Position sizing adapté au drawdown
// =============================================
export class RiskManager {
  private readonly limits: RiskLimits;
  private dailyLoss = 0;
  private dailyTradeCount = 0;  // 🆕 Compteur de trades quotidiens
  private initialPortfolioValue = 0;
  private currentPortfolioValue = 0;
  private isEmergencyStopped = false;
  private isPaused = false;

  // Trailing stops : pair → highWaterMark (prix le plus haut atteint depuis l'entrée)
  private trailingHighs: Map<string, number> = new Map();

  constructor(customLimits?: Partial<RiskLimits>) {
    this.limits = {
      maxPositionSize: config.trading.maxPositionSize,
      maxTradeAmountUsd: config.trading.maxTradeAmountUsd,
      maxOpenTrades: 3,
      stopLossPercent: config.trading.defaultStopLoss,         // 3%
      takeProfitPercent: config.trading.defaultTakeProfit,      // 6%
      maxDailyLoss: config.trading.maxTradeAmountUsd * 2,
      maxDrawdown: config.trading.maxDrawdown,
      maxDailyTrades: config.trading.maxDailyTrades,           // 6
      atrMultiplierSL: parseFloat(process.env.ATR_MULTIPLIER_SL || '2.0'),    // 🆕 2.0x (was 1.5x)
      atrMultiplierTP: parseFloat(process.env.ATR_MULTIPLIER_TP || '3.5'),    // 🆕 3.5x (was 2.5x)
      // Trailing stop v2.0
      trailingActivationPct: config.strategy.trailingActivationPct,  // 1.5%
      trailingDistancePct: config.strategy.trailingDistancePct,      // 1.0%
      breakEvenActivationPct: config.strategy.breakEvenActivationPct, // 1.0%
      ...customLimits,
    };
  }

  /**
   * Initialise avec la valeur initiale du portefeuille
   */
  setPortfolioValue(initial: number, current: number): void {
    if (this.initialPortfolioValue === 0 && initial > 0) {
      this.initialPortfolioValue = initial;
    }
    this.currentPortfolioValue = current;
  }

  /**
   * Calcule la taille de position optimale
   * v2.0 : Réduit l'exposition quand le drawdown augmente
   */
  calculatePositionSize(
    portfolioUsd: number,
    price: number,
    openTradesCount: number,
    signalStrength: number,
    atrPercent?: number,
  ): PositionSizeResult {
    // Vérifications de blocage
    if (this.isEmergencyStopped) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: '🛑 Arrêt d\'urgence actif' };
    }

    if (this.isPaused) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: '⏸️ Bot en pause' };
    }

    if (openTradesCount >= this.limits.maxOpenTrades) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: `Max trades ouverts atteint (${this.limits.maxOpenTrades})` };
    }

    // 🆕 Vérification du nombre de trades journaliers
    if (this.dailyTradeCount >= this.limits.maxDailyTrades) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: `Max trades journaliers atteint (${this.dailyTradeCount}/${this.limits.maxDailyTrades})` };
    }

    if (this.dailyLoss >= this.limits.maxDailyLoss) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: `Perte journalière max atteinte ($${this.dailyLoss.toFixed(2)})` };
    }

    // Vérification drawdown
    const drawdown = this.getDrawdown();
    if (drawdown >= this.limits.maxDrawdown) {
      this.triggerEmergencyStop();
      return { allowed: false, quantity: 0, amountUsd: 0, reason: `Drawdown maximum atteint (${(drawdown * 100).toFixed(1)}%)` };
    }

    // Calcul du montant de base : min(capital × maxPositionSize, maxTradeAmountUSD)
    const baseAmount = Math.min(
      portfolioUsd * this.limits.maxPositionSize,
      this.limits.maxTradeAmountUsd
    );

    // Ajustement selon la force du signal (0.5 = 50%, 1.0 = 100% du max)
    let adjustedAmount = baseAmount * Math.max(0.5, signalStrength);

    // 🆕 Ajustement selon la volatilité ATR
    if (atrPercent !== undefined && atrPercent > 0) {
      if (atrPercent > 4) {
        adjustedAmount *= 0.5; // Réduction forte sur haute volatilité
        logger.debug(`💡 Position réduite à 50% (ATR élevé: ${atrPercent.toFixed(1)}%)`);
      } else if (atrPercent > 2.5) {
        adjustedAmount *= 0.7; // Réduction modérée
        logger.debug(`💡 Position réduite à 70% (ATR modéré: ${atrPercent.toFixed(1)}%)`);
      } else if (atrPercent < 1) {
        adjustedAmount *= 1.1; // Légère augmentation sur marché calme
      }
    }

    // 🆕 Réduction proportionnelle au drawdown
    // Plus on perd, plus on réduit la taille des positions
    if (drawdown > 0.05) { // > 5% de drawdown
      const drawdownPenalty = 1 - (drawdown * 2); // 5% DD → 90%, 10% DD → 80%
      adjustedAmount *= Math.max(0.5, drawdownPenalty);
      logger.debug(`💡 Position réduite par drawdown (${(drawdown * 100).toFixed(1)}%)`);
    }

    // Vérification capital suffisant (garde 10% de marge au lieu de 5%)
    if (adjustedAmount > portfolioUsd * 0.90) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: 'Capital insuffisant (marge 10%)' };
    }

    if (adjustedAmount < 1) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: 'Montant trop faible (<$1)' };
    }

    const quantity = adjustedAmount / price;

    return {
      allowed: true,
      quantity,
      amountUsd: adjustedAmount,
    };
  }

  /**
   * Calcule les niveaux de sortie dynamiques basés sur l'ATR
   * v2.0 : Ratio Risk/Reward amélioré de 1:1.67 → 1:1.75
   */
  calculateExitLevels(
    entryPrice: number,
    side: 'buy' | 'sell',
    atrValue?: number
  ): ExitLevels {
    if (atrValue && atrValue > 0) {
      // Stop-loss et Take-profit dynamiques basés sur l'ATR
      const slDistance = this.limits.atrMultiplierSL * atrValue; // 2.0x ATR
      const tpDistance = this.limits.atrMultiplierTP * atrValue; // 3.5x ATR → R:R 1:1.75

      if (side === 'buy') {
        return {
          stopLoss: entryPrice - slDistance,
          takeProfit: entryPrice + tpDistance,
          method: 'atr',
        };
      } else {
        return {
          stopLoss: entryPrice + slDistance,
          takeProfit: entryPrice - tpDistance,
          method: 'atr',
        };
      }
    }

    // Fallback : stop-loss/take-profit fixes en % (3% / 6%)
    if (side === 'buy') {
      return {
        stopLoss: entryPrice * (1 - this.limits.stopLossPercent),
        takeProfit: entryPrice * (1 + this.limits.takeProfitPercent),
        method: 'fixed',
      };
    } else {
      return {
        stopLoss: entryPrice * (1 + this.limits.stopLossPercent),
        takeProfit: entryPrice * (1 - this.limits.takeProfitPercent),
        method: 'fixed',
      };
    }
  }

  /**
   * Vérifie si un trade ouvert doit être fermé
   * v2.0 : Trailing stop réaliste + Breakeven stop
   *
   * Logique de sortie en 3 phases :
   * 1. Si le trade gagne +1% → SL remonte au breakeven (protection capital)
   * 2. Si le trade gagne +1.5% → Trailing stop activé (1.0% sous le high)
   * 3. Stop-loss / Take-profit classiques toujours actifs
   */
  checkExitConditions(
    trade: { id?: number; pair?: string; side: 'buy' | 'sell'; entry_price: number; stop_loss?: number; take_profit?: number; fees?: number },
    currentPrice: number
  ): { shouldClose: boolean; reason: string; newStopLoss?: number } {
    const { side, entry_price, stop_loss, take_profit } = trade;
    const pair = trade.pair || 'UNKNOWN';
    const fees = trade.fees || 0;

    if (side === 'buy') {
      // Calcul du gain actuel en %
      const currentGainPct = (currentPrice - entry_price) / entry_price;

      // === Phase 1 : Breakeven Stop ===
      // Après +1% de gain, remonter le SL au breakeven (prix d'entrée + frais)
      let effectiveStopLoss = stop_loss || 0;
      let newStopLoss: number | undefined;

      const breakEvenPrice = entry_price * (1 + 0.005); // Breakeven = entrée + 0.5% (couvre les frais AR)

      if (currentGainPct >= this.limits.breakEvenActivationPct) {
        // Phase 1 active : le SL ne peut pas être en dessous du breakeven
        if (effectiveStopLoss < breakEvenPrice) {
          newStopLoss = breakEvenPrice;
          effectiveStopLoss = breakEvenPrice;
          logger.debug(`[${pair}] 🔒 Breakeven stop activé : $${breakEvenPrice.toFixed(2)} (gain: +${(currentGainPct * 100).toFixed(2)}%)`);
        }
      }

      // === Phase 2 : Trailing Stop ===
      // Après +1.5% de gain, trail à 1.0% sous le high
      const highWaterMark = this.trailingHighs.get(pair) || currentPrice;
      if (currentPrice > highWaterMark) {
        this.trailingHighs.set(pair, currentPrice);
      }
      const actualHigh = this.trailingHighs.get(pair) || currentPrice;

      if (actualHigh > entry_price * (1 + this.limits.trailingActivationPct)) {
        const trailingStop = actualHigh * (1 - this.limits.trailingDistancePct);
        if (trailingStop > effectiveStopLoss) {
          newStopLoss = trailingStop;
          effectiveStopLoss = trailingStop;
          logger.debug(`[${pair}] 📈 Trailing SL : $${trailingStop.toFixed(2)} (high: $${actualHigh.toFixed(2)}, trail: ${(this.limits.trailingDistancePct * 100).toFixed(1)}%)`);
        }
      }

      // === Vérification Stop-Loss ===
      if (effectiveStopLoss > 0 && currentPrice <= effectiveStopLoss) {
        this.trailingHighs.delete(pair);
        const pnlPct = ((currentPrice - entry_price) / entry_price * 100).toFixed(2);
        const isBreakeven = currentGainPct >= this.limits.breakEvenActivationPct;
        const isTrailing = actualHigh > entry_price * (1 + this.limits.trailingActivationPct);

        let emoji = '🛑';
        let label = 'Stop-Loss';
        if (isTrailing) { emoji = '📈'; label = 'Trailing Stop'; }
        else if (isBreakeven) { emoji = '🔒'; label = 'Breakeven Stop'; }

        return {
          shouldClose: true,
          reason: `${emoji} ${label} déclenché ($${currentPrice.toFixed(2)} ≤ $${effectiveStopLoss.toFixed(2)}) | P&L: ${pnlPct}%`,
        };
      }

      // === Vérification Take-Profit ===
      if (take_profit && currentPrice >= take_profit) {
        this.trailingHighs.delete(pair);
        const pnlPct = ((currentPrice - entry_price) / entry_price * 100).toFixed(2);
        return {
          shouldClose: true,
          reason: `🎯 Take-Profit atteint ($${currentPrice.toFixed(2)} ≥ $${take_profit.toFixed(2)}) | P&L: +${pnlPct}%`,
        };
      }

      // Retourner le nouveau SL si le trailing ou breakeven a évolué
      if (newStopLoss) {
        return { shouldClose: false, reason: '', newStopLoss };
      }

    } else {
      // Position short (gestion basique)
      if (stop_loss && currentPrice >= stop_loss) {
        return { shouldClose: true, reason: `Stop-Loss déclenché ($${currentPrice.toFixed(2)} ≥ $${stop_loss.toFixed(2)})` };
      }
      if (take_profit && currentPrice <= take_profit) {
        return { shouldClose: true, reason: `Take-Profit atteint ($${currentPrice.toFixed(2)} ≤ $${take_profit.toFixed(2)})` };
      }
    }

    return { shouldClose: false, reason: '' };
  }

  /**
   * Enregistre une perte journalière
   */
  recordLoss(amount: number): void {
    this.dailyLoss += Math.abs(amount);
    logger.warn(`💸 Perte enregistrée : -$${amount.toFixed(2)} | Total jour : -$${this.dailyLoss.toFixed(2)}`);
  }

  /**
   * 🆕 Enregistre un trade exécuté (pour le compteur journalier)
   */
  recordTrade(): void {
    this.dailyTradeCount++;
    logger.debug(`📊 Trades aujourd'hui : ${this.dailyTradeCount}/${this.limits.maxDailyTrades}`);
  }

  /**
   * 🆕 Vérifie si on peut encore trader aujourd'hui
   */
  canTrade(): boolean {
    return this.dailyTradeCount < this.limits.maxDailyTrades;
  }

  /**
   * Remet à zéro les compteurs journaliers (appelé chaque matin)
   */
  resetDailyCounters(): void {
    this.dailyLoss = 0;
    this.dailyTradeCount = 0;
    logger.info('🔄 Compteurs journaliers remis à zéro');
  }

  /**
   * Calcule le drawdown actuel
   */
  getDrawdown(): number {
    if (this.initialPortfolioValue === 0) return 0;
    return Math.max(0, (this.initialPortfolioValue - this.currentPortfolioValue) / this.initialPortfolioValue);
  }

  /**
   * Nettoie le trailing stop pour une paire (à appeler à la fermeture d'un trade)
   */
  clearTrailing(pair: string): void {
    this.trailingHighs.delete(pair);
  }

  /**
   * Déclenche l'arrêt d'urgence
   */
  triggerEmergencyStop(): void {
    this.isEmergencyStopped = true;
    logger.error('🚨 ARRÊT D\'URGENCE déclenché — drawdown maximum atteint !');
  }

  pause(): void {
    this.isPaused = true;
    logger.info('⏸️ Bot mis en pause');
  }

  resume(): void {
    this.isPaused = false;
    this.isEmergencyStopped = false;
    logger.info('▶️ Bot repris');
  }

  isActive(): boolean {
    return !this.isPaused && !this.isEmergencyStopped;
  }

  getStatus(): object {
    return {
      active: this.isActive(),
      paused: this.isPaused,
      emergencyStopped: this.isEmergencyStopped,
      dailyLoss: this.dailyLoss,
      dailyTrades: this.dailyTradeCount,
      maxDailyTrades: this.limits.maxDailyTrades,
      drawdown: (this.getDrawdown() * 100).toFixed(2) + '%',
      limits: this.limits,
    };
  }
}
