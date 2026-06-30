import {
  RSI, MACD, EMA, BollingerBands, SMA, ATR, Stochastic
} from 'technicalindicators';
import { Candle } from '../connectors/coinbase';

// =============================================
// Types de Résultats d'Indicateurs
// =============================================
export interface RSIResult {
  value: number;
  oversold: boolean;   // < 30
  overbought: boolean; // > 70
  trend: 'up' | 'down' | 'neutral';
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  crossover: 'bullish' | 'bearish' | 'none'; // Croisement récent
}

export interface EMAResult {
  ema20: number;
  ema50: number;
  ema200: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  goldenCross: boolean; // EMA20 croise EMA50 vers le haut
  deathCross: boolean;  // EMA20 croise EMA50 vers le bas
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;    // Position du prix dans les bandes (0=bas, 1=haut)
  squeezing: boolean;  // Bandes très serrées
}

export interface ATRResult {
  value: number;       // Average True Range
  percent: number;     // ATR en % du prix
}

export interface StochasticResult {
  k: number;
  d: number;
  oversold: boolean;
  overbought: boolean;
}

export interface FullIndicators {
  rsi: RSIResult;
  macd: MACDResult;
  ema: EMAResult;
  bollinger: BollingerResult;
  atr: ATRResult;
  stochastic: StochasticResult;
  volume: {
    current: number;
    average: number;
    ratio: number;    // > 1.5 = volume élevé
  };
}

// =============================================
// Calcul des Indicateurs Techniques
// =============================================
export class TechnicalAnalysis {
  /**
   * Calcule tous les indicateurs d'un coup
   */
  static compute(candles: Candle[]): FullIndicators | null {
    if (candles.length < 50) {
      return null; // Pas assez de données
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    return {
      rsi: this.computeRSI(closes),
      macd: this.computeMACD(closes),
      ema: this.computeEMA(closes),
      bollinger: this.computeBollinger(closes),
      atr: this.computeATR(highs, lows, closes),
      stochastic: this.computeStochastic(highs, lows, closes),
      volume: this.computeVolume(volumes),
    };
  }

  // =============================================
  // RSI (Relative Strength Index)
  // =============================================
  static computeRSI(closes: number[], period = 14): RSIResult {
    const values = RSI.calculate({ values: closes, period });
    const current = values[values.length - 1] || 50;
    const previous = values[values.length - 2] || 50;

    return {
      value: current,
      oversold: current < 30,
      overbought: current > 70,
      trend: current > previous ? 'up' : current < previous ? 'down' : 'neutral',
    };
  }

  // =============================================
  // MACD (Moving Average Convergence Divergence)
  // =============================================
  static computeMACD(closes: number[]): MACDResult {
    const values = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const current = values[values.length - 1];
    const previous = values[values.length - 2];

    if (!current || !previous) {
      return { macd: 0, signal: 0, histogram: 0, crossover: 'none' };
    }

    // Détection du croisement
    let crossover: 'bullish' | 'bearish' | 'none' = 'none';
    const prevMacd = previous.MACD || 0;
    const prevSignal = previous.signal || 0;
    const currMacd = current.MACD || 0;
    const currSignal = current.signal || 0;

    if (prevMacd < prevSignal && currMacd > currSignal) {
      crossover = 'bullish'; // MACD passe au-dessus du signal
    } else if (prevMacd > prevSignal && currMacd < currSignal) {
      crossover = 'bearish'; // MACD passe en-dessous du signal
    }

    return {
      macd: currMacd,
      signal: currSignal,
      histogram: current.histogram || 0,
      crossover,
    };
  }

  // =============================================
  // EMA (Exponential Moving Averages)
  // =============================================
  static computeEMA(closes: number[]): EMAResult {
    const ema20Values = EMA.calculate({ values: closes, period: 20 });
    const ema50Values = EMA.calculate({ values: closes, period: 50 });
    const ema200Values = EMA.calculate({ values: closes, period: 200 });

    const ema20 = ema20Values[ema20Values.length - 1] || 0;
    const ema50 = ema50Values[ema50Values.length - 1] || 0;
    const ema200 = ema200Values[ema200Values.length - 1] || 0;

    const prevEma20 = ema20Values[ema20Values.length - 2] || 0;
    const prevEma50 = ema50Values[ema50Values.length - 2] || 0;

    // Golden Cross / Death Cross
    const goldenCross = prevEma20 < prevEma50 && ema20 > ema50;
    const deathCross = prevEma20 > prevEma50 && ema20 < ema50;

    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (ema20 > ema50 && ema50 > ema200) trend = 'bullish';
    else if (ema20 < ema50 && ema50 < ema200) trend = 'bearish';

    return { ema20, ema50, ema200, trend, goldenCross, deathCross };
  }

  // =============================================
  // Bandes de Bollinger
  // =============================================
  static computeBollinger(closes: number[], period = 20, stdDev = 2): BollingerResult {
    const values = BollingerBands.calculate({
      values: closes,
      period,
      stdDev,
    });

    const current = values[values.length - 1];
    if (!current) {
      const last = closes[closes.length - 1];
      return { upper: last, middle: last, lower: last, bandwidth: 0, percentB: 0.5, squeezing: false };
    }

    const price = closes[closes.length - 1];
    const bandwidth = (current.upper - current.lower) / current.middle;
    const percentB = (price - current.lower) / (current.upper - current.lower);

    // Squeeze = bandwidth < 2% (bandes très serrées = explosion imminente)
    const squeezing = bandwidth < 0.02;

    return {
      upper: current.upper,
      middle: current.middle,
      lower: current.lower,
      bandwidth,
      percentB: Math.max(0, Math.min(1, percentB)),
      squeezing,
    };
  }

  // =============================================
  // ATR (Average True Range) — Volatilité
  // =============================================
  static computeATR(highs: number[], lows: number[], closes: number[], period = 14): ATRResult {
    const values = ATR.calculate({ high: highs, low: lows, close: closes, period });
    const value = values[values.length - 1] || 0;
    const price = closes[closes.length - 1];

    return {
      value,
      percent: price > 0 ? (value / price) * 100 : 0,
    };
  }

  // =============================================
  // Stochastique
  // =============================================
  static computeStochastic(
    highs: number[], lows: number[], closes: number[],
    period = 14, signalPeriod = 3
  ): StochasticResult {
    const values = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
      signalPeriod,
    });

    const current = values[values.length - 1];
    if (!current) return { k: 50, d: 50, oversold: false, overbought: false };

    return {
      k: current.k,
      d: current.d,
      oversold: current.k < 20,
      overbought: current.k > 80,
    };
  }

  // =============================================
  // Volume
  // =============================================
  static computeVolume(volumes: number[], period = 20): { current: number; average: number; ratio: number } {
    const current = volumes[volumes.length - 1] || 0;
    const recent = volumes.slice(-period);
    const average = recent.reduce((a, b) => a + b, 0) / recent.length;

    return {
      current,
      average,
      ratio: average > 0 ? current / average : 1,
    };
  }

  /**
   * Calcule un niveau de support/résistance simple
   */
  static getSupportResistance(candles: Candle[], lookback = 20): { support: number; resistance: number } {
    const recent = candles.slice(-lookback);
    const lows = recent.map((c) => c.low);
    const highs = recent.map((c) => c.high);

    return {
      support: Math.min(...lows),
      resistance: Math.max(...highs),
    };
  }
}
