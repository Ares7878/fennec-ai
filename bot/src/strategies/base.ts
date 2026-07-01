import { Candle } from '../connectors/coinbase';
import { FullIndicators } from './indicators';

// =============================================
// Types de Base
// =============================================
export type SignalType = 'buy' | 'sell' | 'hold';

export interface StrategySignal {
  signal: SignalType;
  strength: number;   // 0 à 1 (1 = signal très fort)
  reason: string;
  indicators: Partial<FullIndicators>;
  price: number;
}

export interface StrategyConfig {
  pair: string;
  interval: string;
  params?: Record<string, number>;
}

// =============================================
// Interface de Base pour Toutes les Stratégies
// =============================================
export abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly description: string;

  protected config: StrategyConfig;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  /**
   * Analyse les bougies et retourne un signal
   */
  abstract analyze(candles: Candle[]): StrategySignal;

  /**
   * Helper pour générer un signal 'hold'
   */
  protected holdSignal(price: number, reason: string): StrategySignal {
    return {
      signal: 'hold',
      strength: 0,
      reason,
      indicators: {},
      price,
    };
  }

  /**
   * Vérifie si on a assez de données
   */
  protected hasEnoughData(candles: Candle[], minCandles: number): boolean {
    return candles.length >= minCandles;
  }
}
