import { Candle } from '../connectors/coinbase';
import { TechnicalAnalysis, FullIndicators } from './indicators';
import { BaseStrategy, StrategySignal, StrategyConfig } from './base';
import { config } from '../config';

// =============================================
// 🦊 Stratégie Breakout Momentum v4.0
// =============================================
// Philosophie :
// ✅ Ne trade que lors de vraies cassures de résistances ou de supports
// ✅ Attentiste : reste 'hold' la majorité du temps
// ✅ Confirmations avec volume et RSI
// ✅ Idéal pour paires volatiles (DOGE, XRP, AVAX)
// =============================================

export class BreakoutStrategy extends BaseStrategy {
  readonly name = 'breakout';
  readonly description = 'Breakout Momentum v4.0 — Attend une cassure forte avec volume';

  private readonly MIN_SCORE = config.strategy.minScore; // Par défaut 72

  analyze(candles: Candle[]): StrategySignal {
    if (!this.hasEnoughData(candles, 60)) {
      const price = candles[candles.length - 1]?.close || 0;
      return this.holdSignal(price, `Données insuffisantes (${candles.length}/60 bougies)`);
    }

    const indicators = TechnicalAnalysis.compute(candles);
    if (!indicators) {
      return this.holdSignal(candles[candles.length - 1].close, 'Calcul indicateurs impossible');
    }

    const price = candles[candles.length - 1].close;
    const { rsi, bollinger, volume, atr, macd } = indicators;

    // Calcul de la résistance / support local (ex: sur les 20 dernières bougies)
    const recentCandles = candles.slice(-20);
    const localHigh = Math.max(...recentCandles.map(c => c.high));
    const localLow = Math.min(...recentCandles.map(c => c.low));

    // Distance au plus haut/plus bas local en %
    const distToHigh = (localHigh - price) / price;
    const distToLow = (price - localLow) / price;

    // Est-ce qu'on est très proche de casser la résistance/support ou est-ce déjà fait ?
    const breakoutBullish = price > localHigh * 0.998; // Cassure ou très proche
    const breakoutBearish = price < localLow * 1.002;

    // =============================================
    // Calcul du score BUY (0-100)
    // =============================================
    let buyScore = 0;
    const buyReasons: string[] = [];

    // 1. Condition principale : Cassure haussière
    if (breakoutBullish) {
      buyScore += 40;
      buyReasons.push(`Breakout Résistance(+40)`);
    }

    // 2. Confirmation Volume (très important pour un vrai breakout)
    if (volume.ratio >= 1.8) {
      buyScore += 20;
      buyReasons.push(`Volume Fort x${volume.ratio.toFixed(1)}(+20)`);
    } else if (volume.ratio >= 1.3) {
      buyScore += 10;
      buyReasons.push(`Volume OK(+10)`);
    } else {
      buyScore -= 20; // Faux breakout sans volume
    }

    // 3. Confirmation RSI (Momentum)
    if (rsi.value > 52 && rsi.value < 75) {
      buyScore += 15;
      buyReasons.push(`RSI Sain ${rsi.value.toFixed(0)}(+15)`);
    } else if (rsi.value >= 75) {
      buyScore -= 10; // Déjà trop en surachat
    }

    // 4. Volatilité / Bollinger Squeeze (Cassure après un range est plus forte)
    if (bollinger.bandwidth < 0.05) { // Bandes serrées = compression
      buyScore += 15;
      buyReasons.push(`Compression BB(+15)`);
    }

    // 5. MACD Momentum
    if (macd.histogram > 0 && macd.crossover === 'bullish') {
      buyScore += 10;
      buyReasons.push(`MACD Cross(+10)`);
    } else if (macd.histogram > 0) {
      buyScore += 5;
    }

    // =============================================
    // Calcul du score SELL (0-100)
    // =============================================
    let sellScore = 0;
    const sellReasons: string[] = [];

    // 1. Condition principale : Cassure baissière
    if (breakoutBearish) {
      sellScore += 40;
      sellReasons.push(`Breakout Support(+40)`);
    }

    // 2. Confirmation Volume
    if (volume.ratio >= 1.8) {
      sellScore += 20;
      sellReasons.push(`Volume Fort x${volume.ratio.toFixed(1)}(+20)`);
    } else if (volume.ratio >= 1.3) {
      sellScore += 10;
      sellReasons.push(`Volume OK(+10)`);
    } else {
      sellScore -= 20; // Faux breakout sans volume
    }

    // 3. Confirmation RSI
    if (rsi.value < 48 && rsi.value > 25) {
      sellScore += 15;
      sellReasons.push(`RSI Sain ${rsi.value.toFixed(0)}(+15)`);
    } else if (rsi.value <= 25) {
      sellScore -= 10; // Déjà trop en survendu
    }

    // 4. Volatilité / Bollinger Squeeze
    if (bollinger.bandwidth < 0.05) {
      sellScore += 15;
      sellReasons.push(`Compression BB(+15)`);
    }

    // 5. MACD Momentum
    if (macd.histogram < 0 && macd.crossover === 'bearish') {
      sellScore += 10;
      sellReasons.push(`MACD Cross(+10)`);
    } else if (macd.histogram < 0) {
      sellScore += 5;
    }

    // Normalize scores
    buyScore = Math.max(0, Math.min(100, buyScore));
    sellScore = Math.max(0, Math.min(100, sellScore));

    const detail = `[BREAKOUT] BUY:${buyScore} SELL:${sellScore} (min:${this.MIN_SCORE}) | VolR:${volume.ratio.toFixed(1)} DistH:${(distToHigh * 100).toFixed(1)}%`;

    if (buyScore >= this.MIN_SCORE && buyScore > sellScore) {
      return {
        signal: 'buy',
        strength: Math.min(1, buyScore / 100),
        reason: `[BREAKOUT] BUY Score:${buyScore}/100 — ${buyReasons.join(' ')}`,
        indicators,
        price,
      };
    }

    if (sellScore >= this.MIN_SCORE && sellScore > buyScore) {
      return {
        signal: 'sell',
        strength: Math.min(1, sellScore / 100),
        reason: `[BREAKOUT] SELL Score:${sellScore}/100 — ${sellReasons.join(' ')}`,
        indicators,
        price,
      };
    }

    return this.holdSignal(price, detail);
  }
}
