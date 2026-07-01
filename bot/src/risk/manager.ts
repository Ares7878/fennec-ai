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
  atrMultiplierSL: number;  // Multiplicateur ATR pour stop-loss dynamique (ex: 1.5)
  atrMultiplierTP: number;  // Multiplicateur ATR pour take-profit dynamique (ex: 2.5)
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
// Gestionnaire de Risques (version optimisée)
// =============================================
export class RiskManager {
  private readonly limits: RiskLimits;
  private dailyLoss = 0;
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
      stopLossPercent: config.trading.defaultStopLoss,
      takeProfitPercent: config.trading.defaultTakeProfit,
      maxDailyLoss: config.trading.maxTradeAmountUsd * 2,
      maxDrawdown: config.trading.maxDrawdown,
      atrMultiplierSL: parseFloat(process.env.ATR_MULTIPLIER_SL || '1.5'),
      atrMultiplierTP: parseFloat(process.env.ATR_MULTIPLIER_TP || '2.5'),
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
   * Adapte le montant selon la volatilité ATR (plus volatile = position plus petite)
   */
  calculatePositionSize(
    portfolioUsd: number,
    price: number,
    openTradesCount: number,
    signalStrength: number,
    atrPercent?: number, // ATR en % du prix (ex: 2.5 = 2.5%)
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
    // Si ATR > 3%, réduire la taille de position (risque plus élevé)
    // Si ATR < 1%, augmenter légèrement (marché calme)
    if (atrPercent !== undefined && atrPercent > 0) {
      if (atrPercent > 4) {
        adjustedAmount *= 0.6; // Réduction forte sur haute volatilité
        logger.debug(`💡 Position réduite (ATR élevé: ${atrPercent.toFixed(1)}%)`);
      } else if (atrPercent > 2.5) {
        adjustedAmount *= 0.8; // Réduction modérée
      } else if (atrPercent < 1) {
        adjustedAmount *= 1.1; // Légère augmentation sur marché calme
      }
    }

    // Vérification capital suffisant (garde 5% de marge)
    if (adjustedAmount > portfolioUsd * 0.95) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: 'Capital insuffisant' };
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
   * 🆕 Calcule les niveaux de sortie dynamiques basés sur l'ATR
   * Ratio Risk/Reward : 1.5×ATR (SL) vs 2.5×ATR (TP) = R:R de 1:1.67
   */
  calculateExitLevels(
    entryPrice: number,
    side: 'buy' | 'sell',
    atrValue?: number // Valeur ATR absolue (ex: 1200 pour BTC à volatilité normale)
  ): ExitLevels {
    if (atrValue && atrValue > 0) {
      // Stop-loss et Take-profit dynamiques basés sur l'ATR
      const slDistance = this.limits.atrMultiplierSL * atrValue;
      const tpDistance = this.limits.atrMultiplierTP * atrValue;

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

    // Fallback : stop-loss/take-profit fixes en %
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
   * 🆕 Vérifie si un trade ouvert doit être fermé
   * Intègre le trailing stop-loss : le SL remonte avec le prix
   */
  checkExitConditions(
    trade: { id?: number; pair?: string; side: 'buy' | 'sell'; entry_price: number; stop_loss?: number; take_profit?: number },
    currentPrice: number
  ): { shouldClose: boolean; reason: string; newStopLoss?: number } {
    const { side, entry_price, stop_loss, take_profit } = trade;
    const pair = trade.pair || 'UNKNOWN';

    if (side === 'buy') {
      // === Trailing Stop-Loss ===
      // Maintenir le prix le plus haut depuis l'entrée
      const highWaterMark = this.trailingHighs.get(pair) || currentPrice;
      if (currentPrice > highWaterMark) {
        this.trailingHighs.set(pair, currentPrice);
      }
      const actualHigh = this.trailingHighs.get(pair) || currentPrice;

      // Le SL remonte si le prix a monté de plus de 0.3%
      // Nouveau SL = highWaterMark - 0.2% (protège les gains acquis agressivement pour le micro-scalping)
      const trailingActivationPct = 0.003; // Active le trailing après +0.3%
      const trailDistance = 0.002; // Trail à 0.2% sous le high

      let effectiveStopLoss = stop_loss || 0;
      let newStopLoss: number | undefined;

      if (actualHigh > entry_price * (1 + trailingActivationPct)) {
        const trailingStop = actualHigh * (1 - trailDistance);
        if (trailingStop > effectiveStopLoss) {
          newStopLoss = trailingStop;
          effectiveStopLoss = trailingStop;
          logger.debug(`[${pair}] 📈 Trailing SL mis à jour : $${trailingStop.toFixed(2)} (high: $${actualHigh.toFixed(2)})`);
        }
      }

      // Vérification Stop-Loss
      if (effectiveStopLoss > 0 && currentPrice <= effectiveStopLoss) {
        this.trailingHighs.delete(pair);
        const isTrailing = newStopLoss !== undefined || (stop_loss && effectiveStopLoss !== stop_loss);
        return {
          shouldClose: true,
          reason: `${isTrailing ? '📈 Trailing' : '🛑'} Stop-Loss déclenché ($${currentPrice.toFixed(2)} ≤ $${effectiveStopLoss.toFixed(2)})`,
        };
      }

      // Vérification Take-Profit
      if (take_profit && currentPrice >= take_profit) {
        this.trailingHighs.delete(pair);
        return { shouldClose: true, reason: `🎯 Take-Profit atteint ($${currentPrice.toFixed(2)} ≥ $${take_profit.toFixed(2)})` };
      }

      // Retourner le nouveau SL si le trailing a évolué
      if (newStopLoss) {
        return { shouldClose: false, reason: '', newStopLoss };
      }

    } else {
      // Position short (rare sur ce bot, mais gérons-la)
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
   * Remet à zéro les compteurs journaliers (appelé chaque matin)
   */
  resetDailyCounters(): void {
    this.dailyLoss = 0;
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
      drawdown: (this.getDrawdown() * 100).toFixed(2) + '%',
      limits: this.limits,
    };
  }
}
