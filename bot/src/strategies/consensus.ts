import { Candle } from '../connectors/coinbase';
import { TechnicalAnalysis, FullIndicators } from './indicators';
import { BaseStrategy, StrategySignal, StrategyConfig } from './base';

// =============================================
// 🧠 Stratégie Consensus Multi-Signal
// =============================================
// Agrège RSI + MACD + EMA + Bollinger.
// N'exécute un trade que si au moins 3 stratégies
// sur 4 sont en accord (seuil configurable).
// Ajoute un filtre de tendance macro (EMA200).
// =============================================

interface SubSignal {
  name: string;
  direction: 'buy' | 'sell' | 'hold';
  strength: number;
  reason: string;
}

export class ConsensusStrategy extends BaseStrategy {
  readonly name = 'consensus';
  readonly description = 'Agrégation multi-signal (RSI+MACD+EMA+Bollinger) avec filtre EMA200';

  // Seuil minimum de signaux concordants pour trader
  private readonly MIN_CONSENSUS = parseInt(process.env.MIN_CONSENSUS || '3');

  analyze(candles: Candle[]): StrategySignal {
    if (!this.hasEnoughData(candles, 210)) {
      const price = candles[candles.length - 1]?.close || 0;
      return this.holdSignal(price, `Données insuffisantes (${candles.length}/210 bougies)`);
    }

    const indicators = TechnicalAnalysis.compute(candles);
    if (!indicators) {
      return this.holdSignal(candles[candles.length - 1].close, 'Calcul indicateurs impossible');
    }

    const price = candles[candles.length - 1].close;
    const { rsi, macd, ema, bollinger, volume, atr } = indicators;

    // =============================================
    // Filtre Tendance Macro : EMA200
    // =============================================
    // On n'achète que si le prix est AU-DESSUS de l'EMA200
    // On ne vend que si le prix est EN-DESSOUS de l'EMA200
    const macroTrendBullish = ema.ema200 > 0 ? price > ema.ema200 : true;
    const macroTrendBearish = ema.ema200 > 0 ? price < ema.ema200 : true;

    // =============================================
    // Sous-signal RSI
    // =============================================
    const rsiSignal = this.evalRSI(rsi, ema, volume);

    // =============================================
    // Sous-signal MACD
    // =============================================
    const macdSignal = this.evalMACD(macd, rsi, volume);

    // =============================================
    // Sous-signal EMA Cross
    // =============================================
    const emaCrossSignal = this.evalEMACross(ema, price, volume);

    // =============================================
    // Sous-signal Bollinger
    // =============================================
    const bollingerSignal = this.evalBollinger(bollinger, rsi);

    const allSignals: SubSignal[] = [rsiSignal, macdSignal, emaCrossSignal, bollingerSignal];

    // =============================================
    // Comptage des votes
    // =============================================
    const buyVotes = allSignals.filter((s) => s.direction === 'buy');
    const sellVotes = allSignals.filter((s) => s.direction === 'sell');

    const buyCount = buyVotes.length;
    const sellCount = sellVotes.length;

    // =============================================
    // Signal BUY : consensus + filtre macro
    // =============================================
    if (buyCount >= this.MIN_CONSENSUS && macroTrendBullish) {
      const avgStrength = buyVotes.reduce((s, v) => s + v.strength, 0) / buyVotes.length;
      const bonusMacroAlignment = ema.trend === 'bullish' ? 0.1 : 0;
      const finalStrength = Math.min(1, avgStrength + bonusMacroAlignment + (buyCount === 4 ? 0.1 : 0));

      const reasons = buyVotes.map((s) => `${s.name}(${(s.strength * 100).toFixed(0)}%)`).join(' + ');

      return {
        signal: 'buy',
        strength: finalStrength,
        reason: `Consensus ${buyCount}/4 : ${reasons}${ema.trend === 'bullish' ? ' | Tendance haussière ✅' : ''}`,
        indicators,
        price,
      };
    }

    // =============================================
    // Signal SELL : consensus + filtre macro
    // =============================================
    if (sellCount >= this.MIN_CONSENSUS && macroTrendBearish) {
      const avgStrength = sellVotes.reduce((s, v) => s + v.strength, 0) / sellVotes.length;
      const bonusMacroAlignment = ema.trend === 'bearish' ? 0.1 : 0;
      const finalStrength = Math.min(1, avgStrength + bonusMacroAlignment + (sellCount === 4 ? 0.1 : 0));

      const reasons = sellVotes.map((s) => `${s.name}(${(s.strength * 100).toFixed(0)}%)`).join(' + ');

      return {
        signal: 'sell',
        strength: finalStrength,
        reason: `Consensus ${sellCount}/4 : ${reasons}${ema.trend === 'bearish' ? ' | Tendance baissière ✅' : ''}`,
        indicators,
        price,
      };
    }

    // HOLD : pas assez de consensus ou filtre macro bloque
    const detail = `Buy:${buyCount} Sell:${sellCount} (min:${this.MIN_CONSENSUS}) | ` +
      `RSI:${rsi.value.toFixed(0)} EMA:${ema.trend} MACD:${macd.crossover}`;
    return this.holdSignal(price, detail);
  }

  // =============================================
  // Évaluation RSI
  // =============================================
  private evalRSI(
    rsi: FullIndicators['rsi'],
    ema: FullIndicators['ema'],
    volume: FullIndicators['volume']
  ): SubSignal {
    // Achat : RSI survendu (<32) + tendance RSI à la hausse
    if (rsi.value < 32 && rsi.trend === 'up' && ema.trend !== 'bearish' && volume.ratio > 0.7) {
      const strength = Math.min(1, 0.5 + (32 - rsi.value) / 25 + (volume.ratio > 1.5 ? 0.15 : 0));
      return { name: 'RSI', direction: 'buy', strength, reason: `RSI survendu ${rsi.value.toFixed(0)}` };
    }
    // Vente : RSI surachat (>68) + tendance RSI à la baisse
    if (rsi.value > 68 && rsi.trend === 'down' && ema.trend !== 'bullish' && volume.ratio > 0.7) {
      const strength = Math.min(1, 0.5 + (rsi.value - 68) / 25 + (volume.ratio > 1.5 ? 0.15 : 0));
      return { name: 'RSI', direction: 'sell', strength, reason: `RSI surachat ${rsi.value.toFixed(0)}` };
    }
    return { name: 'RSI', direction: 'hold', strength: 0, reason: `RSI neutre ${rsi.value.toFixed(0)}` };
  }

  // =============================================
  // Évaluation MACD
  // =============================================
  private evalMACD(
    macd: FullIndicators['macd'],
    rsi: FullIndicators['rsi'],
    volume: FullIndicators['volume']
  ): SubSignal {
    // Croisement haussier MACD
    if (macd.crossover === 'bullish' && rsi.value < 65 && volume.ratio > 1.0) {
      const strength = Math.min(1, 0.55 + (volume.ratio > 2 ? 0.2 : 0) + (rsi.value < 40 ? 0.15 : 0));
      return { name: 'MACD', direction: 'buy', strength, reason: `Croisement haussier` };
    }
    // Croisement baissier MACD
    if (macd.crossover === 'bearish' && rsi.value > 35 && volume.ratio > 1.0) {
      const strength = Math.min(1, 0.55 + (volume.ratio > 2 ? 0.2 : 0) + (rsi.value > 60 ? 0.15 : 0));
      return { name: 'MACD', direction: 'sell', strength, reason: `Croisement baissier` };
    }
    // Signal faible mais présent : histogram en tendance
    if (macd.histogram > 0 && macd.macd > 0) {
      return { name: 'MACD', direction: 'buy', strength: 0.35, reason: `Histogram positif` };
    }
    if (macd.histogram < 0 && macd.macd < 0) {
      return { name: 'MACD', direction: 'sell', strength: 0.35, reason: `Histogram négatif` };
    }
    return { name: 'MACD', direction: 'hold', strength: 0, reason: `Pas de croisement` };
  }

  // =============================================
  // Évaluation EMA Cross
  // =============================================
  private evalEMACross(
    ema: FullIndicators['ema'],
    price: number,
    volume: FullIndicators['volume']
  ): SubSignal {
    // Golden Cross (fort)
    if (ema.goldenCross && price > ema.ema200) {
      const strength = Math.min(1, 0.7 + (volume.ratio > 1.5 ? 0.2 : 0));
      return { name: 'EMA', direction: 'buy', strength, reason: `Golden Cross` };
    }
    // Death Cross (fort)
    if (ema.deathCross && price < ema.ema200) {
      const strength = Math.min(1, 0.7 + (volume.ratio > 1.5 ? 0.2 : 0));
      return { name: 'EMA', direction: 'sell', strength, reason: `Death Cross` };
    }
    // Tendance bullish confirmée (EMA20 > EMA50 > EMA200)
    if (ema.trend === 'bullish') {
      return { name: 'EMA', direction: 'buy', strength: 0.5, reason: `Tendance haussière` };
    }
    // Tendance bearish confirmée
    if (ema.trend === 'bearish') {
      return { name: 'EMA', direction: 'sell', strength: 0.5, reason: `Tendance baissière` };
    }
    return { name: 'EMA', direction: 'hold', strength: 0, reason: `Neutre` };
  }

  // =============================================
  // Évaluation Bollinger Bands
  // =============================================
  private evalBollinger(
    bollinger: FullIndicators['bollinger'],
    rsi: FullIndicators['rsi']
  ): SubSignal {
    // Squeeze → signal neutre (attente de la cassure)
    if (bollinger.squeezing) {
      return { name: 'BB', direction: 'hold', strength: 0, reason: `Squeeze` };
    }
    // Rebond sur bande inférieure + RSI survendu
    if (bollinger.percentB < 0.08 && rsi.value < 38) {
      const strength = Math.min(1, 0.5 + (1 - bollinger.percentB) * 0.4 + (32 - Math.min(32, rsi.value)) / 100);
      return { name: 'BB', direction: 'buy', strength, reason: `Bande inférieure B%:${(bollinger.percentB * 100).toFixed(0)}%` };
    }
    // Rebond sur bande supérieure + RSI surachat
    if (bollinger.percentB > 0.92 && rsi.value > 62) {
      const strength = Math.min(1, 0.5 + bollinger.percentB * 0.4 + (rsi.value - 62) / 100);
      return { name: 'BB', direction: 'sell', strength, reason: `Bande supérieure B%:${(bollinger.percentB * 100).toFixed(0)}%` };
    }
    return { name: 'BB', direction: 'hold', strength: 0, reason: `B%:${(bollinger.percentB * 100).toFixed(0)}%` };
  }
}
