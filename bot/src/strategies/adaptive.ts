import { Candle } from '../connectors/alpaca';
import { TechnicalAnalysis, FullIndicators } from './indicators';
import { BaseStrategy, StrategySignal, StrategyConfig } from './base';
import { config } from '../config';

// =============================================
// 🦊 Stratégie Adaptive v1.0
// =============================================
// Remplace la stratégie Consensus qui ne tradait jamais.
//
// Philosophie :
// ✅ Scoring continu (0-100) plutôt qu'un vote majoritaire
// ✅ Deux modes : Trending (ADX>22) et Ranging (ADX<22)
// ✅ L'ADX oriente le mode — ne bloque plus les trades
// ✅ Bougies 15m par défaut pour plus d'opportunités
// ✅ Filtres légers (pénalités de score, pas de blocage dur)
// =============================================

export class AdaptiveStrategy extends BaseStrategy {
  readonly name = 'adaptive';
  readonly description = 'Stratégie adaptative v1.0 — Scoring 0-100, modes Trending/Ranging';

  // Score minimum pour déclencher un trade (configurable via MIN_SCORE env)
  private readonly MIN_SCORE = parseFloat(process.env.MIN_SCORE || '62');
  // Seuil ADX pour considérer que le marché est en tendance
  private readonly ADX_TREND_THRESHOLD = config.strategy.minADX;

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
    const { rsi, macd, ema, bollinger, volume, adx, stochastic, rsiDivergence, atr } = indicators;

    // =============================================
    // Détection du régime de marché
    // =============================================
    const isTrending = adx.value >= this.ADX_TREND_THRESHOLD;
    const isRanging = !isTrending;
    const mode = isTrending ? 'TRENDING' : 'RANGING';

    // =============================================
    // Filtre volume (souple — pénalité pas blocage)
    // =============================================
    const volumeOk = volume.ratio >= 0.6;

    // =============================================
    // Calcul du score BUY (0-100)
    // =============================================
    let buyScore = 0;
    const buyReasons: string[] = [];

    if (isTrending) {
      // === MODE TRENDING : cherche le momentum dans la direction de la tendance ===

      // RSI momentum (0-25 pts) — pas besoin d'être extrême, juste favorabe
      if (rsi.value < 45) {
        const pts = Math.round(((45 - rsi.value) / 45) * 25);
        buyScore += pts;
        buyReasons.push(`RSI${rsi.value.toFixed(0)}(+${pts})`);
      } else if (rsi.value < 55) {
        buyScore += 8; // Zone neutre légèrement favorable
        buyReasons.push(`RSI neutre(+8)`);
      }

      // MACD direction (0-25 pts) — histogramme positif ou en croissance
      const macdBullish = macd.histogram > 0 || macd.crossover === 'bullish';
      if (macd.crossover === 'bullish') {
        buyScore += 25;
        buyReasons.push(`MACD cross haussier(+25)`);
      } else if (macdBullish && macd.histogram > 0) {
        const pts = Math.min(20, Math.round(macd.histogram > 0 ? 15 : 0));
        buyScore += pts;
        buyReasons.push(`MACD haussier(+${pts})`);
      }

      // EMA alignment (0-25 pts) — tendance EMA favorable
      if (ema.goldenCross) {
        buyScore += 25;
        buyReasons.push(`Golden Cross(+25)`);
      } else if (ema.trend === 'bullish') {
        buyScore += 18;
        buyReasons.push(`EMA bullish(+18)`);
      } else if (ema.ema20 > ema.ema50) {
        buyScore += 10;
        buyReasons.push(`EMA20>EMA50(+10)`);
      }

      // EMA200 macro-filtre (0-15 pts)
      if (price > ema.ema200 && ema.ema200 > 0) {
        buyScore += 15;
        buyReasons.push(`>EMA200(+15)`);
      } else if (ema.ema200 > 0 && price < ema.ema200) {
        buyScore -= 10; // Pénalité (contre-tendance macro)
      }

      // ADX direction bonus (0-10 pts)
      if (adx.trendDirection === 'bullish') {
        buyScore += 10;
        buyReasons.push(`ADX${adx.value.toFixed(0)} haussier(+10)`);
      }

    } else {
      // === MODE RANGING : cherche les rebonds aux extrêmes ===

      // RSI oversold (0-35 pts) — principal signal en mode range
      if (rsi.value < 30) {
        const pts = Math.round(((30 - rsi.value) / 30) * 35);
        buyScore += Math.min(35, pts + 15);
        buyReasons.push(`RSI survendu ${rsi.value.toFixed(0)}(+${Math.min(35, pts + 15)})`);
      } else if (rsi.value < 40) {
        const pts = Math.round(((40 - rsi.value) / 10) * 15);
        buyScore += pts;
        buyReasons.push(`RSI bas ${rsi.value.toFixed(0)}(+${pts})`);
      }

      // Bollinger bande inférieure (0-35 pts) — signal fort en range
      if (bollinger.percentB < 0.1) {
        const pts = Math.round((0.1 - bollinger.percentB) / 0.1 * 35);
        buyScore += Math.min(35, pts + 20);
        buyReasons.push(`BB bas ${(bollinger.percentB * 100).toFixed(0)}%(+${Math.min(35, pts + 20)})`);
      } else if (bollinger.percentB < 0.25) {
        const pts = Math.round((0.25 - bollinger.percentB) / 0.25 * 15);
        buyScore += pts;
        buyReasons.push(`BB inférieure(+${pts})`);
      }

      // Stochastique oversold (0-20 pts)
      if (stochastic.oversold) {
        buyScore += 20;
        buyReasons.push(`Stoch survendu(+20)`);
      } else if (stochastic.k < 30) {
        buyScore += 10;
        buyReasons.push(`Stoch bas(+10)`);
      }

      // MACD pas trop baissier (0-10 pts bonus)
      if (macd.crossover === 'bullish') {
        buyScore += 10;
        buyReasons.push(`MACD cross(+10)`);
      } else if (macd.histogram > 0) {
        buyScore += 5;
      }
    }

    // =============================================
    // Bonus universels BUY (valables dans les 2 modes)
    // =============================================
    if (rsiDivergence.bullish) {
      buyScore += 12;
      buyReasons.push(`Divergence RSI(+12)`);
    }
    if (rsi.trend === 'up' && rsi.value < 50) {
      buyScore += 5;
    }
    if (!volumeOk) {
      buyScore -= 15; // Pénalité volume faible
    }

    // =============================================
    // Calcul du score SELL (0-100)
    // =============================================
    let sellScore = 0;
    const sellReasons: string[] = [];

    if (isTrending) {
      // === MODE TRENDING : cherche le momentum baissier ===

      // RSI momentum (0-25 pts)
      if (rsi.value > 55) {
        const pts = Math.round(((rsi.value - 55) / 45) * 25);
        sellScore += pts;
        sellReasons.push(`RSI${rsi.value.toFixed(0)}(+${pts})`);
      } else if (rsi.value > 45) {
        sellScore += 8;
      }

      // MACD (0-25 pts)
      if (macd.crossover === 'bearish') {
        sellScore += 25;
        sellReasons.push(`MACD cross baissier(+25)`);
      } else if (macd.histogram < 0) {
        sellScore += 15;
        sellReasons.push(`MACD baissier(+15)`);
      }

      // EMA alignment (0-25 pts)
      if (ema.deathCross) {
        sellScore += 25;
        sellReasons.push(`Death Cross(+25)`);
      } else if (ema.trend === 'bearish') {
        sellScore += 18;
        sellReasons.push(`EMA bearish(+18)`);
      } else if (ema.ema20 < ema.ema50) {
        sellScore += 10;
        sellReasons.push(`EMA20<EMA50(+10)`);
      }

      // EMA200 macro-filtre (0-15 pts)
      if (price < ema.ema200 && ema.ema200 > 0) {
        sellScore += 15;
        sellReasons.push(`<EMA200(+15)`);
      } else if (ema.ema200 > 0 && price > ema.ema200) {
        sellScore -= 10; // Pénalité (contre-tendance macro)
      }

      // ADX direction bonus (0-10 pts)
      if (adx.trendDirection === 'bearish') {
        sellScore += 10;
        sellReasons.push(`ADX${adx.value.toFixed(0)} baissier(+10)`);
      }

    } else {
      // === MODE RANGING : cherche les rebonds en haut ===

      // RSI overbought (0-35 pts)
      if (rsi.value > 70) {
        const pts = Math.round(((rsi.value - 70) / 30) * 35);
        sellScore += Math.min(35, pts + 15);
        sellReasons.push(`RSI surachat ${rsi.value.toFixed(0)}(+${Math.min(35, pts + 15)})`);
      } else if (rsi.value > 60) {
        const pts = Math.round(((rsi.value - 60) / 10) * 15);
        sellScore += pts;
        sellReasons.push(`RSI haut ${rsi.value.toFixed(0)}(+${pts})`);
      }

      // Bollinger bande supérieure (0-35 pts)
      if (bollinger.percentB > 0.9) {
        const pts = Math.round((bollinger.percentB - 0.9) / 0.1 * 35);
        sellScore += Math.min(35, pts + 20);
        sellReasons.push(`BB haut ${(bollinger.percentB * 100).toFixed(0)}%(+${Math.min(35, pts + 20)})`);
      } else if (bollinger.percentB > 0.75) {
        const pts = Math.round((bollinger.percentB - 0.75) / 0.25 * 15);
        sellScore += pts;
        sellReasons.push(`BB supérieure(+${pts})`);
      }

      // Stochastique overbought (0-20 pts)
      if (stochastic.overbought) {
        sellScore += 20;
        sellReasons.push(`Stoch surachat(+20)`);
      } else if (stochastic.k > 70) {
        sellScore += 10;
        sellReasons.push(`Stoch haut(+10)`);
      }

      // MACD confirmation (0-10 pts)
      if (macd.crossover === 'bearish') {
        sellScore += 10;
        sellReasons.push(`MACD cross(+10)`);
      } else if (macd.histogram < 0) {
        sellScore += 5;
      }
    }

    // =============================================
    // Bonus universels SELL
    // =============================================
    if (rsiDivergence.bearish) {
      sellScore += 12;
      sellReasons.push(`Divergence RSI(+12)`);
    }
    if (rsi.trend === 'down' && rsi.value > 50) {
      sellScore += 5;
    }
    if (!volumeOk) {
      sellScore -= 15; // Pénalité volume faible
    }

    // Normalize scores to [0, 100]
    buyScore = Math.max(0, Math.min(100, buyScore));
    sellScore = Math.max(0, Math.min(100, sellScore));

    // =============================================
    // Décision finale
    // =============================================
    const detail = `[${mode}] BUY:${buyScore} SELL:${sellScore} (min:${this.MIN_SCORE}) | ` +
      `RSI:${rsi.value.toFixed(0)} ADX:${adx.value.toFixed(0)} BB:${(bollinger.percentB * 100).toFixed(0)}%`;

    // Signal BUY si score assez fort et supérieur au SELL
    if (buyScore >= this.MIN_SCORE && buyScore > sellScore) {
      const strength = Math.min(1, buyScore / 100);
      return {
        signal: 'buy',
        strength,
        reason: `[${mode}] Score BUY:${buyScore}/100 — ${buyReasons.slice(0, 4).join(' ')}`,
        indicators,
        price,
      };
    }

    // Signal SELL si score assez fort et supérieur au BUY
    if (sellScore >= this.MIN_SCORE && sellScore > buyScore) {
      const strength = Math.min(1, sellScore / 100);
      return {
        signal: 'sell',
        strength,
        reason: `[${mode}] Score SELL:${sellScore}/100 — ${sellReasons.slice(0, 4).join(' ')}`,
        indicators,
        price,
      };
    }

    return this.holdSignal(price, detail);
  }
}
