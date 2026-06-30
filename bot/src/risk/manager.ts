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
}

export interface PositionSizeResult {
  allowed: boolean;
  quantity: number;
  amountUsd: number;
  reason?: string;
}

// =============================================
// Gestionnaire de Risques
// =============================================
export class RiskManager {
  private readonly limits: RiskLimits;
  private dailyLoss = 0;
  private initialPortfolioValue = 0;
  private currentPortfolioValue = 0;
  private isEmergencyStopped = false;
  private isPaused = false;

  constructor(customLimits?: Partial<RiskLimits>) {
    this.limits = {
      maxPositionSize: config.trading.maxPositionSize,
      maxTradeAmountUsd: config.trading.maxTradeAmountUsd,
      maxOpenTrades: 3,
      stopLossPercent: config.trading.defaultStopLoss,
      takeProfitPercent: config.trading.defaultTakeProfit,
      maxDailyLoss: config.trading.maxTradeAmountUsd * 2,
      maxDrawdown: config.trading.maxDrawdown,
      ...customLimits,
    };
  }

  /**
   * Initialise avec la valeur initiale du portefeuille
   */
  setPortfolioValue(initial: number, current: number): void {
    if (this.initialPortfolioValue === 0) {
      this.initialPortfolioValue = initial;
    }
    this.currentPortfolioValue = current;
  }

  /**
   * Calcule la taille de position optimale (Kelly Criterion simplifié)
   */
  calculatePositionSize(
    portfolioUsd: number,
    price: number,
    openTradesCount: number,
    signalStrength: number,
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

    // Calcul du montant : base * force du signal
    const baseAmount = Math.min(
      portfolioUsd * this.limits.maxPositionSize,
      this.limits.maxTradeAmountUsd
    );

    // Ajustement selon la force du signal (0.5 = 50%, 1.0 = 100% du max)
    const adjustedAmount = baseAmount * Math.max(0.5, signalStrength);

    // Vérification capital suffisant
    if (adjustedAmount > portfolioUsd * 0.95) {
      return { allowed: false, quantity: 0, amountUsd: 0, reason: 'Capital insuffisant' };
    }

    const quantity = adjustedAmount / price;

    return {
      allowed: true,
      quantity,
      amountUsd: adjustedAmount,
    };
  }

  /**
   * Calcule les prix de Stop-Loss et Take-Profit
   */
  calculateExitLevels(entryPrice: number, side: 'buy' | 'sell'): {
    stopLoss: number;
    takeProfit: number;
  } {
    if (side === 'buy') {
      return {
        stopLoss: entryPrice * (1 - this.limits.stopLossPercent),
        takeProfit: entryPrice * (1 + this.limits.takeProfitPercent),
      };
    } else {
      return {
        stopLoss: entryPrice * (1 + this.limits.stopLossPercent),
        takeProfit: entryPrice * (1 - this.limits.takeProfitPercent),
      };
    }
  }

  /**
   * Vérifie si un trade ouvert doit être fermé (stop-loss / take-profit)
   */
  checkExitConditions(
    trade: { side: 'buy' | 'sell'; entry_price: number; stop_loss?: number; take_profit?: number },
    currentPrice: number
  ): { shouldClose: boolean; reason: string } {
    const { side, entry_price, stop_loss, take_profit } = trade;

    if (side === 'buy') {
      if (stop_loss && currentPrice <= stop_loss) {
        return { shouldClose: true, reason: `Stop-Loss déclenché ($${currentPrice.toFixed(2)} ≤ $${stop_loss.toFixed(2)})` };
      }
      if (take_profit && currentPrice >= take_profit) {
        return { shouldClose: true, reason: `Take-Profit atteint ($${currentPrice.toFixed(2)} ≥ $${take_profit.toFixed(2)})` };
      }
    } else {
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
