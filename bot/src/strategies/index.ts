import { Candle } from '../connectors/coinbase';
import { TechnicalAnalysis, FullIndicators } from './indicators';
import { ConsensusStrategy } from './consensus';

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
   * Méthode principale : analyse les chandeliers et retourne un signal
   */
  abstract analyze(candles: Candle[]): StrategySignal;

  /**
   * Vérifie qu'il y a assez de données
   */
  protected hasEnoughData(candles: Candle[], minimum: number): boolean {
    return candles.length >= minimum;
  }

  /**
   * Signal neutre par défaut
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
}

// =============================================
// Stratégie RSI
// =============================================
export class RSIStrategy extends BaseStrategy {
  readonly name = 'rsi';
  readonly description = 'RSI avec zones de survente/surachat + confirmation de tendance EMA';

  private readonly RSI_OVERSOLD = 30;
  private readonly RSI_OVERBOUGHT = 70;
  private readonly RSI_PERIOD = 14;

  analyze(candles: Candle[]): StrategySignal {
    if (!this.hasEnoughData(candles, 50)) {
      return this.holdSignal(candles[candles.length - 1]?.close || 0, 'Données insuffisantes');
    }

    const indicators = TechnicalAnalysis.compute(candles);
    if (!indicators) return this.holdSignal(candles[candles.length - 1].close, 'Calcul impossible');

    const price = candles[candles.length - 1].close;
    const { rsi, ema, volume } = indicators;

    // ACHAT : RSI survendu + tendance haussière + volume correct
    if (
      rsi.value < this.RSI_OVERSOLD &&
      rsi.trend === 'up' &&
      ema.trend !== 'bearish' &&
      volume.ratio > 0.8
    ) {
      const strength = Math.min(1, (this.RSI_OVERSOLD - rsi.value) / 20 + (volume.ratio > 1.5 ? 0.2 : 0));
      return {
        signal: 'buy',
        strength,
        reason: `RSI survendu (${rsi.value.toFixed(1)}) avec tendance haussière`,
        indicators,
        price,
      };
    }

    // VENTE : RSI surachat + tendance baissière + volume correct
    if (
      rsi.value > this.RSI_OVERBOUGHT &&
      rsi.trend === 'down' &&
      ema.trend !== 'bullish' &&
      volume.ratio > 0.8
    ) {
      const strength = Math.min(1, (rsi.value - this.RSI_OVERBOUGHT) / 20 + (volume.ratio > 1.5 ? 0.2 : 0));
      return {
        signal: 'sell',
        strength,
        reason: `RSI surachat (${rsi.value.toFixed(1)}) avec tendance baissière`,
        indicators,
        price,
      };
    }

    return this.holdSignal(price, `RSI neutre : ${rsi.value.toFixed(1)}`);
  }
}

// =============================================
// Stratégie MACD
// =============================================
export class MACDStrategy extends BaseStrategy {
  readonly name = 'macd';
  readonly description = 'Croisements MACD/Signal avec confirmation RSI et volume';

  analyze(candles: Candle[]): StrategySignal {
    if (!this.hasEnoughData(candles, 60)) {
      return this.holdSignal(candles[candles.length - 1]?.close || 0, 'Données insuffisantes');
    }

    const indicators = TechnicalAnalysis.compute(candles);
    if (!indicators) return this.holdSignal(candles[candles.length - 1].close, 'Calcul impossible');

    const price = candles[candles.length - 1].close;
    const { macd, rsi, volume } = indicators;

    // ACHAT : Croisement haussier MACD + RSI pas surachat + volume élevé
    if (
      macd.crossover === 'bullish' &&
      rsi.value < 65 &&
      volume.ratio > 1.2
    ) {
      const strength = Math.min(1, 0.6 + (volume.ratio > 2 ? 0.3 : 0) + (rsi.value < 40 ? 0.2 : 0));
      return {
        signal: 'buy',
        strength,
        reason: `Croisement MACD haussier (${macd.macd.toFixed(4)} > signal)`,
        indicators,
        price,
      };
    }

    // VENTE : Croisement baissier MACD + RSI pas survendu + volume élevé
    if (
      macd.crossover === 'bearish' &&
      rsi.value > 35 &&
      volume.ratio > 1.2
    ) {
      const strength = Math.min(1, 0.6 + (volume.ratio > 2 ? 0.3 : 0) + (rsi.value > 60 ? 0.2 : 0));
      return {
        signal: 'sell',
        strength,
        reason: `Croisement MACD baissier (${macd.macd.toFixed(4)} < signal)`,
        indicators,
        price,
      };
    }

    return this.holdSignal(price, `Pas de croisement MACD (histogram: ${macd.histogram.toFixed(4)})`);
  }
}

// =============================================
// Stratégie EMA Cross
// =============================================
export class EMACrossStrategy extends BaseStrategy {
  readonly name = 'ema_cross';
  readonly description = 'Croisements EMA 20/50 (Golden Cross / Death Cross) + confirmation EMA 200';

  analyze(candles: Candle[]): StrategySignal {
    if (!this.hasEnoughData(candles, 210)) {
      return this.holdSignal(candles[candles.length - 1]?.close || 0, 'Données insuffisantes (EMA 200 requiert 210 bougies)');
    }

    const indicators = TechnicalAnalysis.compute(candles);
    if (!indicators) return this.holdSignal(candles[candles.length - 1].close, 'Calcul impossible');

    const price = candles[candles.length - 1].close;
    const { ema, volume } = indicators;

    // ACHAT : Golden Cross (EMA20 passe au-dessus de EMA50) + prix au-dessus EMA200
    if (ema.goldenCross && price > ema.ema200) {
      return {
        signal: 'buy',
        strength: Math.min(1, 0.7 + (volume.ratio > 1.5 ? 0.2 : 0)),
        reason: `Golden Cross EMA20/EMA50 (prix > EMA200)`,
        indicators,
        price,
      };
    }

    // VENTE : Death Cross (EMA20 passe en-dessous de EMA50) + prix en-dessous EMA200
    if (ema.deathCross && price < ema.ema200) {
      return {
        signal: 'sell',
        strength: Math.min(1, 0.7 + (volume.ratio > 1.5 ? 0.2 : 0)),
        reason: `Death Cross EMA20/EMA50 (prix < EMA200)`,
        indicators,
        price,
      };
    }

    return this.holdSignal(price, `EMA20: ${ema.ema20.toFixed(2)} | EMA50: ${ema.ema50.toFixed(2)} | Tendance: ${ema.trend}`);
  }
}

// =============================================
// Stratégie Bollinger Bands
// =============================================
export class BollingerStrategy extends BaseStrategy {
  readonly name = 'bollinger';
  readonly description = 'Rebond sur les bandes de Bollinger avec confirmation RSI';

  analyze(candles: Candle[]): StrategySignal {
    if (!this.hasEnoughData(candles, 50)) {
      return this.holdSignal(candles[candles.length - 1]?.close || 0, 'Données insuffisantes');
    }

    const indicators = TechnicalAnalysis.compute(candles);
    if (!indicators) return this.holdSignal(candles[candles.length - 1].close, 'Calcul impossible');

    const price = candles[candles.length - 1].close;
    const { bollinger, rsi } = indicators;

    // ACHAT : Prix touche la bande inférieure + RSI survendu (rebond attendu)
    if (bollinger.percentB < 0.05 && rsi.value < 35) {
      return {
        signal: 'buy',
        strength: Math.min(1, 0.5 + (1 - bollinger.percentB) * 0.4 + (30 - rsi.value) / 100),
        reason: `Prix sur bande Bollinger inférieure (B%: ${(bollinger.percentB * 100).toFixed(1)}%) + RSI ${rsi.value.toFixed(1)}`,
        indicators,
        price,
      };
    }

    // VENTE : Prix touche la bande supérieure + RSI surachat
    if (bollinger.percentB > 0.95 && rsi.value > 65) {
      return {
        signal: 'sell',
        strength: Math.min(1, 0.5 + bollinger.percentB * 0.4 + (rsi.value - 70) / 100),
        reason: `Prix sur bande Bollinger supérieure (B%: ${(bollinger.percentB * 100).toFixed(1)}%) + RSI ${rsi.value.toFixed(1)}`,
        indicators,
        price,
      };
    }

    // SIGNAL SPÉCIAL : Squeeze (explosion imminente)
    if (bollinger.squeezing) {
      return this.holdSignal(price, `⚡ Squeeze Bollinger détecté — attendre la cassure`);
    }

    return this.holdSignal(price, `B%: ${(bollinger.percentB * 100).toFixed(1)}% | Pas de signal`);
  }
}

// =============================================
// Factory — Crée la stratégie selon la config
// =============================================
export function createStrategy(name: string, config: StrategyConfig): BaseStrategy {
  switch (name) {
    case 'rsi': return new RSIStrategy(config);
    case 'macd': return new MACDStrategy(config);
    case 'ema_cross': return new EMACrossStrategy(config);
    case 'bollinger': return new BollingerStrategy(config);
    case 'consensus': return new ConsensusStrategy(config);
    default:
      throw new Error(`Stratégie inconnue : ${name}. Utilisez : rsi, macd, ema_cross, bollinger, consensus`);
  }
}

export { ConsensusStrategy };
