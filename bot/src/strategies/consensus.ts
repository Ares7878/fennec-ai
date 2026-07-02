import { Candle } from '../connectors/coinbase';
import { TechnicalAnalysis, FullIndicators } from './indicators';
import { BaseStrategy, StrategySignal, StrategyConfig } from './base';
import { config } from '../config';

// =============================================
// 🧠 Stratégie Consensus Multi-Signal v2.0
// =============================================
// VERSION OPTIMISÉE — Corrections des faux signaux
//
// Changements majeurs par rapport à v1.0 :
// ✅ Les signaux MACD "faibles" (histogram seul) ne comptent plus
// ✅ La tendance EMA seule ne compte plus (seulement Golden/Death Cross)
// ✅ Filtre ADX : pas de trade si ADX < 20 (marché en range)
// ✅ Volume minimum global requis (ratio > 0.8)
// ✅ Divergence RSI comme bonus de confirmation
// ✅ Stochastique comme confirmation supplémentaire
// =============================================

interface SubSignal {
  name: string;
  direction: 'buy' | 'sell' | 'hold';
  strength: number;
  reason: string;
}

export class ConsensusStrategy extends BaseStrategy {
  readonly name = 'consensus';
  readonly description = 'Consensus multi-signal v2.0 (RSI+MACD+EMA+BB) avec filtres ADX/Volume/Divergence';

  // Seuil minimum de signaux concordants pour trader
  private readonly MIN_CONSENSUS = parseInt(process.env.MIN_CONSENSUS || '3');
  // ADX minimum pour considérer qu'il y a une tendance tradable
  private readonly MIN_ADX = config.strategy.minADX;

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
    const { rsi, macd, ema, bollinger, volume, atr, adx, stochastic, rsiDivergence } = indicators;

    // =============================================
    // 🛡️ FILTRE #1 : ADX — Marché en Range
    // =============================================
    // Si ADX < 20, le marché est latéral (ranging).
    // Les indicateurs de momentum (RSI, MACD) génèrent des
    // faux signaux dans ce cas → on ne trade PAS.
    if (!adx.trending) {
      return this.holdSignal(
        price,
        `⏸️ ADX trop faible (${adx.value.toFixed(1)} < ${this.MIN_ADX}) — Marché en range, pas de trade`
      );
    }

    // =============================================
    // 🛡️ FILTRE #2 : Volume Minimum Global
    // =============================================
    // Pas de trade si le volume est anormalement bas
    if (volume.ratio < 0.8) {
      return this.holdSignal(
        price,
        `📉 Volume trop faible (ratio: ${volume.ratio.toFixed(2)} < 0.8) — Pas de confirmation`
      );
    }

    // =============================================
    // 🛡️ FILTRE #3 : Tendance Macro EMA200
    // =============================================
    // Filtre OBLIGATOIRE : on n'achète que au-dessus de l'EMA200
    const macroTrendBullish = ema.ema200 > 0 ? price > ema.ema200 : true;
    const macroTrendBearish = ema.ema200 > 0 ? price < ema.ema200 : true;

    // =============================================
    // Sous-signaux (seulement des signaux FORTS)
    // =============================================
    const rsiSignal = this.evalRSI(rsi, ema, volume, stochastic);
    const macdSignal = this.evalMACD(macd, rsi, volume);
    const emaCrossSignal = this.evalEMACross(ema, price, volume);
    const bollingerSignal = this.evalBollinger(bollinger, rsi);

    const allSignals: SubSignal[] = [rsiSignal, macdSignal, emaCrossSignal, bollingerSignal];

    // =============================================
    // Comptage des votes (signaux forts uniquement)
    // =============================================
    const buyVotes = allSignals.filter((s) => s.direction === 'buy');
    const sellVotes = allSignals.filter((s) => s.direction === 'sell');

    const buyCount = buyVotes.length;
    const sellCount = sellVotes.length;

    // =============================================
    // Signal BUY : consensus + filtre macro + ADX
    // =============================================
    if (buyCount >= this.MIN_CONSENSUS && macroTrendBullish) {
      const avgStrength = buyVotes.reduce((s, v) => s + v.strength, 0) / buyVotes.length;

      // Bonus : alignement complet de la macro-tendance
      let bonus = 0;
      if (ema.trend === 'bullish') bonus += 0.05;
      if (adx.trendDirection === 'bullish') bonus += 0.05;
      // Bonus divergence RSI haussière (signal très fort)
      if (rsiDivergence.bullish) bonus += 0.1;
      // Bonus si stochastique confirme (survendu)
      if (stochastic.oversold) bonus += 0.05;
      // Bonus consensus unanime
      if (buyCount === 4) bonus += 0.1;

      const finalStrength = Math.min(1, avgStrength + bonus);

      const reasons = buyVotes.map((s) => `${s.name}(${(s.strength * 100).toFixed(0)}%)`).join(' + ');
      const extras: string[] = [];
      if (rsiDivergence.bullish) extras.push('RSI Divergence ✅');
      if (stochastic.oversold) extras.push('Stoch survendu ✅');
      if (adx.trendDirection === 'bullish') extras.push(`ADX ${adx.value.toFixed(0)} ✅`);

      return {
        signal: 'buy',
        strength: finalStrength,
        reason: `Consensus ${buyCount}/4 : ${reasons}${extras.length ? ' | ' + extras.join(' ') : ''}`,
        indicators,
        price,
      };
    }

    // =============================================
    // Signal SELL : consensus + filtre macro + ADX
    // =============================================
    if (sellCount >= this.MIN_CONSENSUS && macroTrendBearish) {
      const avgStrength = sellVotes.reduce((s, v) => s + v.strength, 0) / sellVotes.length;

      let bonus = 0;
      if (ema.trend === 'bearish') bonus += 0.05;
      if (adx.trendDirection === 'bearish') bonus += 0.05;
      if (rsiDivergence.bearish) bonus += 0.1;
      if (stochastic.overbought) bonus += 0.05;
      if (sellCount === 4) bonus += 0.1;

      const finalStrength = Math.min(1, avgStrength + bonus);

      const reasons = sellVotes.map((s) => `${s.name}(${(s.strength * 100).toFixed(0)}%)`).join(' + ');
      const extras: string[] = [];
      if (rsiDivergence.bearish) extras.push('RSI Divergence ✅');
      if (stochastic.overbought) extras.push('Stoch surachat ✅');
      if (adx.trendDirection === 'bearish') extras.push(`ADX ${adx.value.toFixed(0)} ✅`);

      return {
        signal: 'sell',
        strength: finalStrength,
        reason: `Consensus ${sellCount}/4 : ${reasons}${extras.length ? ' | ' + extras.join(' ') : ''}`,
        indicators,
        price,
      };
    }

    // HOLD : pas assez de consensus ou filtres bloquent
    const detail = `Buy:${buyCount} Sell:${sellCount} (min:${this.MIN_CONSENSUS}) | ` +
      `RSI:${rsi.value.toFixed(0)} EMA:${ema.trend} MACD:${macd.crossover} ADX:${adx.value.toFixed(0)}`;
    return this.holdSignal(price, detail);
  }

  // =============================================
  // Évaluation RSI (avec confirmation Stochastique)
  // =============================================
  private evalRSI(
    rsi: FullIndicators['rsi'],
    ema: FullIndicators['ema'],
    volume: FullIndicators['volume'],
    stochastic: FullIndicators['stochastic']
  ): SubSignal {
    // Achat : RSI survendu (<32) + tendance RSI à la hausse + stochastique confirme
    if (rsi.value < 32 && rsi.trend === 'up' && ema.trend !== 'bearish' && volume.ratio > 0.8) {
      const stochBonus = stochastic.oversold ? 0.1 : 0;
      const strength = Math.min(1, 0.55 + (32 - rsi.value) / 25 + (volume.ratio > 1.5 ? 0.15 : 0) + stochBonus);
      return { name: 'RSI', direction: 'buy', strength, reason: `RSI survendu ${rsi.value.toFixed(0)}` };
    }
    // Vente : RSI surachat (>68) + tendance RSI à la baisse + stochastique confirme
    if (rsi.value > 68 && rsi.trend === 'down' && ema.trend !== 'bullish' && volume.ratio > 0.8) {
      const stochBonus = stochastic.overbought ? 0.1 : 0;
      const strength = Math.min(1, 0.55 + (rsi.value - 68) / 25 + (volume.ratio > 1.5 ? 0.15 : 0) + stochBonus);
      return { name: 'RSI', direction: 'sell', strength, reason: `RSI surachat ${rsi.value.toFixed(0)}` };
    }
    return { name: 'RSI', direction: 'hold', strength: 0, reason: `RSI neutre ${rsi.value.toFixed(0)}` };
  }

  // =============================================
  // Évaluation MACD (SEULEMENT les croisements forts)
  // =============================================
  private evalMACD(
    macd: FullIndicators['macd'],
    rsi: FullIndicators['rsi'],
    volume: FullIndicators['volume']
  ): SubSignal {
    // ✅ Croisement haussier MACD (signal FORT uniquement)
    if (macd.crossover === 'bullish' && rsi.value < 65 && volume.ratio > 1.0) {
      const strength = Math.min(1, 0.6 + (volume.ratio > 2 ? 0.2 : 0) + (rsi.value < 40 ? 0.15 : 0));
      return { name: 'MACD', direction: 'buy', strength, reason: `Croisement haussier` };
    }
    // ✅ Croisement baissier MACD (signal FORT uniquement)
    if (macd.crossover === 'bearish' && rsi.value > 35 && volume.ratio > 1.0) {
      const strength = Math.min(1, 0.6 + (volume.ratio > 2 ? 0.2 : 0) + (rsi.value > 60 ? 0.15 : 0));
      return { name: 'MACD', direction: 'sell', strength, reason: `Croisement baissier` };
    }
    // ❌ SUPPRIMÉ : les signaux "faibles" (histogram positif/négatif sans croisement)
    // ne comptent PLUS comme votes. Ils généraient des faux consensus.
    return { name: 'MACD', direction: 'hold', strength: 0, reason: `Pas de croisement` };
  }

  // =============================================
  // Évaluation EMA Cross (SEULEMENT Golden/Death Cross)
  // =============================================
  private evalEMACross(
    ema: FullIndicators['ema'],
    price: number,
    volume: FullIndicators['volume']
  ): SubSignal {
    // ✅ Golden Cross (signal FORT) — EMA20 croise EMA50 vers le haut
    if (ema.goldenCross && price > ema.ema200) {
      const strength = Math.min(1, 0.7 + (volume.ratio > 1.5 ? 0.2 : 0));
      return { name: 'EMA', direction: 'buy', strength, reason: `Golden Cross` };
    }
    // ✅ Death Cross (signal FORT) — EMA20 croise EMA50 vers le bas
    if (ema.deathCross && price < ema.ema200) {
      const strength = Math.min(1, 0.7 + (volume.ratio > 1.5 ? 0.2 : 0));
      return { name: 'EMA', direction: 'sell', strength, reason: `Death Cross` };
    }
    // ❌ SUPPRIMÉ : tendance bullish/bearish seule ne compte plus.
    // La tendance EMA est utilisée comme FILTRE macro, pas comme vote.
    return { name: 'EMA', direction: 'hold', strength: 0, reason: `Neutre (pas de cross)` };
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
      const strength = Math.min(1, 0.55 + (1 - bollinger.percentB) * 0.35 + (32 - Math.min(32, rsi.value)) / 100);
      return { name: 'BB', direction: 'buy', strength, reason: `Bande inférieure B%:${(bollinger.percentB * 100).toFixed(0)}%` };
    }
    // Rebond sur bande supérieure + RSI surachat
    if (bollinger.percentB > 0.92 && rsi.value > 62) {
      const strength = Math.min(1, 0.55 + bollinger.percentB * 0.35 + (rsi.value - 62) / 100);
      return { name: 'BB', direction: 'sell', strength, reason: `Bande supérieure B%:${(bollinger.percentB * 100).toFixed(0)}%` };
    }
    return { name: 'BB', direction: 'hold', strength: 0, reason: `B%:${(bollinger.percentB * 100).toFixed(0)}%` };
  }
}
