import { config } from '../config';
import { logger } from '../utils/logger';
import { CoinbaseConnector, Candle } from '../connectors/coinbase';
import { TelegramNotifier, getRandomPhrase } from '../notifiers/telegram';
import { PaperTradingEngine } from './paper';
import { RiskManager } from '../risk/manager';
import { createStrategy, BaseStrategy, StrategySignal } from '../strategies';
import { tradeQueries, signalQueries, portfolioQueries, TradeRecord } from '../database';

// =============================================
// Moteur de Trading Principal (version optimisée)
// =============================================
export class TradingEngine {
  private coinbase: CoinbaseConnector;
  private notifier: TelegramNotifier;
  private riskManager: RiskManager;
  private paperEngine: PaperTradingEngine;
  private strategies: Map<string, BaseStrategy> = new Map();
  private liveprices: Map<string, { price: number; change24h?: number }> = new Map();
  private isRunning = false;
  private analysisInterval: NodeJS.Timeout | null = null;

  // 🆕 Cooldown anti-overtrading : pair → timestamp du dernier trade
  private lastTradeTime: Map<string, number> = new Map();
  private readonly COOLDOWN_MS = config.strategy.tradeCooldownMinutes * 60 * 1000;

  constructor(
    coinbase: CoinbaseConnector,
    notifier: TelegramNotifier,
    riskManager: RiskManager
  ) {
    this.coinbase = coinbase;
    this.notifier = notifier;
    this.riskManager = riskManager;
    this.paperEngine = new PaperTradingEngine(notifier);

    this.reloadStrategies();
    this.registerTelegramCommands();
  }

  // =============================================
  // Initialisation
  // =============================================

  public reloadStrategies(): void {
    for (const pair of config.trading.pairs) {
      const strategy = createStrategy(config.strategy.active, {
        pair,
        interval: config.strategy.candleInterval,
      });
      this.strategies.set(pair, strategy);
      logger.info(`📐 Stratégie "${strategy.name}" chargée pour ${pair}`);
    }
  }

  private registerTelegramCommands(): void {
    this.notifier.registerCommand('status', async () => {
      const status = this.riskManager.getStatus() as any;
      const prices: string[] = [];

      this.liveprices.forEach((data, pair) => {
        prices.push(`• ${pair}: $${data.price.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`);
      });

      // Cooldown restant
      const cooldowns: string[] = [];
      this.lastTradeTime.forEach((ts, pair) => {
        const remaining = Math.max(0, this.COOLDOWN_MS - (Date.now() - ts));
        if (remaining > 0) {
          cooldowns.push(`• ${pair}: ${Math.ceil(remaining / 60000)}min restantes`);
        }
      });

      const lines = [
        `🦊 *Fennec AI — Status*`,
        `_${getRandomPhrase('analyse')}_`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🎯 Mode : *${config.trading.mode.toUpperCase()}${config.trading.mode === 'paper' ? ' (Simulation)' : ''}*`,
        `${status.active ? '▶️ Actif' : status.paused ? '⏸️ En pause' : '🛑 Arrêt urgence'}`,
        `📊 Stratégie : ${config.strategy.active.toUpperCase()}`,
        ``,
        `💹 *Prix actuels :*`,
        ...prices,
        ``,
        `📉 Drawdown : ${status.drawdown}`,
        `💸 Perte journalière : -$${status.dailyLoss.toFixed(2)}`,
      ];

      if (cooldowns.length > 0) {
        lines.push(``, `⏳ *Cooldowns actifs :*`, ...cooldowns);
      }

      return lines.join('\n');
    });

    this.notifier.registerCommand('trades', async () => {
      const trades = tradeQueries.getAll(10);
      if (trades.length === 0) return '📊 Aucun trade enregistré.';

      const lines = [`📋 *Derniers trades :*\n`];
      for (const t of trades) {
        const emoji = t.status === 'open' ? '🔵' : t.pnl >= 0 ? '✅' : '❌';
        const pnlStr = t.status === 'closed' ? ` | P&L: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : ' | Ouvert';
        lines.push(`${emoji} ${t.side.toUpperCase()} ${t.pair} @ $${t.entry_price?.toFixed(2)}${pnlStr}`);
      }
      return lines.join('\n');
    });

    this.notifier.registerCommand('pnl', async () => {
      const stats = tradeQueries.getDailyStats();
      const overall = tradeQueries.getStats();

      if (!stats) return '📊 Aucune donnée disponible.';

      const winRateDay = stats.total_trades > 0 ? ((stats.winning_trades / stats.total_trades) * 100).toFixed(1) : '0';
      const winRateTotal = overall.total_trades > 0 ? ((overall.winning_trades / overall.total_trades) * 100).toFixed(1) : '0';

      return [
        `📊 *P&L Report*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `📅 *Aujourd'hui :*`,
        `• Trades : ${stats.total_trades} (win rate: ${winRateDay}%)`,
        `• P&L : ${stats.total_pnl >= 0 ? '+' : ''}$${(stats.total_pnl || 0).toFixed(2)}`,
        `• Frais : $${(stats.total_fees || 0).toFixed(2)}`,
        ``,
        `📈 *Total historique :*`,
        `• Trades : ${overall.total_trades} (win rate: ${winRateTotal}%)`,
        `• P&L total : ${overall.total_pnl >= 0 ? '+' : ''}$${(overall.total_pnl || 0).toFixed(2)}`,
        `• Meilleur trade : +$${(overall.best_trade || 0).toFixed(2)}`,
        `• Pire trade : -$${Math.abs(overall.worst_trade || 0).toFixed(2)}`,
      ].join('\n');
    });

    this.notifier.registerCommand('portfolio', async () => {
      const pricesMap = new Map<string, number>();
      this.liveprices.forEach((data, pair) => pricesMap.set(pair, data.price));
      return this.paperEngine.getSummary(pricesMap);
    });

    this.notifier.registerCommand('pause', async () => {
      this.riskManager.pause();
      return '⏸️ *Bot mis en pause.* Tapez /resume pour reprendre.';
    });

    this.notifier.registerCommand('resume', async () => {
      this.riskManager.resume();
      return '▶️ *Bot repris !* Trading actif.';
    });
  }

  // =============================================
  // Démarrage & Arrêt
  // =============================================

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Le moteur de trading est déjà démarré');
      return;
    }

    logger.info('🚀 Démarrage du moteur de trading Fennec AI...');
    this.isRunning = true;

    // 🆕 Rechargement des positions paper ouvertes au démarrage
    this.paperEngine.reloadOpenPositions();

    // Abonnement aux prix en temps réel via WebSocket
    this.coinbase.subscribeToTicker(config.trading.pairs, (pair, price, change24h) => {
      this.liveprices.set(pair, { price, change24h });
      // Vérification des stop-loss en temps réel
      this.checkOpenTradesExitConditions(pair, price);
    });

    // Analyse périodique selon l'intervalle choisi
    const intervalMs = this.getIntervalMs(config.strategy.candleInterval);
    logger.info(`⏱️ Analyse toutes les ${config.strategy.candleInterval} (${intervalMs / 1000}s)`);
    logger.info(`⏳ Cooldown anti-overtrading : ${config.strategy.tradeCooldownMinutes} minutes`);

    // Première analyse immédiate
    await this.runAnalysisCycle();

    // Analyses périodiques
    this.analysisInterval = setInterval(async () => {
      await this.runAnalysisCycle();
    }, intervalMs);

    // Snapshot du portefeuille toutes les heures
    setInterval(async () => {
      await this.savePortfolioSnapshot();
    }, 60 * 60 * 1000);

    // Sauvegarde du snapshot initial
    await this.savePortfolioSnapshot();

    logger.info('✅ Moteur de trading démarré avec succès');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }
    this.coinbase.closeWebSocket();
    logger.info('🛑 Moteur de trading arrêté');
  }

  // =============================================
  // Cycle d'Analyse Principal
  // =============================================

  private async runAnalysisCycle(): Promise<void> {
    if (!this.riskManager.isActive()) {
      logger.debug('Bot en pause — cycle ignoré');
      return;
    }

    for (const pair of config.trading.pairs) {
      try {
        await this.analyzePair(pair);
        // Petite pause entre les paires pour ne pas surcharger l'API
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        logger.error(`Erreur analyse ${pair}`, { error: err.message });
      }
    }
  }

  private async analyzePair(pair: string): Promise<void> {
    const strategy = this.strategies.get(pair);
    if (!strategy) return;

    // Récupération des chandeliers
    const candles: Candle[] = await this.coinbase.getCandles(pair, config.strategy.candleInterval, 300);
    if (candles.length < 50) {
      logger.warn(`[${pair}] Pas assez de données (${candles.length} bougies)`);
      return;
    }

    const currentPrice = candles[candles.length - 1].close;
    if (currentPrice > 0) {
      this.liveprices.set(pair, { ...this.liveprices.get(pair), price: currentPrice });
    }

    // Génération du signal
    const signal: StrategySignal = strategy.analyze(candles);

    // Sauvegarde du signal en DB
    const signalId = signalQueries.insert({
      pair,
      strategy: strategy.name,
      signal: signal.signal,
      strength: signal.strength,
      price: signal.price,
      indicators: JSON.stringify(signal.indicators),
      acted_on: 0,
    });

    logger.debug(`[${pair}] Signal: ${signal.signal.toUpperCase()} (force: ${(signal.strength * 100).toFixed(0)}%) | ${signal.reason}`);

    // Seuil de force minimum configurable (défaut 0.55)
    const minStrength = config.strategy.minSignalStrength;

    // Action selon le signal
    if (signal.signal === 'buy' && signal.strength >= minStrength) {
      const executed = await this.executeBuy(pair, signal, currentPrice, candles);
      // Marquer le signal comme "acted on" si un trade a été exécuté
      if (executed) signalQueries.markActedOn(signalId);
    } else if (signal.signal === 'sell' && signal.strength >= minStrength) {
      const executed = await this.executeSell(pair, signal, currentPrice);
      if (executed) signalQueries.markActedOn(signalId);
    }
  }

  // =============================================
  // Exécution des Ordres
  // =============================================

  private async executeBuy(pair: string, signal: StrategySignal, price: number, candles: Candle[]): Promise<boolean> {
    const openTrades = tradeQueries.getOpen(pair);

    // Ne pas acheter si une position est déjà ouverte sur cette paire
    if (openTrades.length > 0) {
      logger.debug(`[${pair}] Position déjà ouverte — achat ignoré`);
      return false;
    }

    // 🆕 Vérification du cooldown anti-overtrading
    const lastTrade = this.lastTradeTime.get(pair);
    if (lastTrade && Date.now() - lastTrade < this.COOLDOWN_MS) {
      const remainingMin = Math.ceil((this.COOLDOWN_MS - (Date.now() - lastTrade)) / 60000);
      logger.debug(`[${pair}] Cooldown actif — ${remainingMin}min restantes`);
      return false;
    }

    const allOpenTrades = tradeQueries.getOpen();
    const cashUSD = config.trading.mode === 'paper'
      ? this.paperEngine.getCashUSD()
      : await this.coinbase.getBalance('USD');

    // 🆕 Extraire l'ATR des indicateurs pour le position sizing
    const atrPercent = (signal.indicators as any)?.atr?.percent;

    const positionSize = this.riskManager.calculatePositionSize(
      cashUSD,
      price,
      allOpenTrades.length,
      signal.strength,
      atrPercent,
    );

    if (!positionSize.allowed) {
      logger.warn(`[${pair}] Achat refusé : ${positionSize.reason}`);
      return false;
    }

    // 🆕 Calcul du stop-loss/take-profit dynamique basé sur l'ATR
    const atrValue = (signal.indicators as any)?.atr?.value;
    const exitLevels = this.riskManager.calculateExitLevels(price, 'buy', atrValue);

    logger.info(`[${pair}] 📐 Exit levels (${exitLevels.method}): SL=$${exitLevels.stopLoss.toFixed(2)} | TP=$${exitLevels.takeProfit.toFixed(2)}`);

    if (config.trading.mode === 'paper') {
      await this.paperEngine.buy(
        pair, price,
        positionSize.amountUsd,
        config.strategy.active,
        exitLevels.stopLoss,
        exitLevels.takeProfit,
        signal.indicators
      );
    } else {
      // Mode LIVE : ordre réel sur Coinbase
      logger.info(`[LIVE] 🟢 ACHAT ${pair} $${positionSize.amountUsd.toFixed(2)} @ $${price}`);
      const order = await this.coinbase.placeMarketOrder(pair, 'BUY', positionSize.amountUsd);

      tradeQueries.insert({
        order_id: order.order_id,
        pair,
        side: 'buy',
        mode: 'live',
        strategy: config.strategy.active,
        entry_price: parseFloat(order.average_filled_price) || price,
        quantity: parseFloat(order.filled_size),
        amount_usd: positionSize.amountUsd,
        fees: parseFloat(order.total_fees),
        pnl: 0,
        pnl_percent: 0,
        stop_loss: exitLevels.stopLoss,
        take_profit: exitLevels.takeProfit,
        status: 'open',
        signal_data: JSON.stringify(signal),
      });

      await this.notifier.notifyTradeOpen({
        pair, side: 'buy', price,
        quantity: parseFloat(order.filled_size),
        amountUSD: positionSize.amountUsd,
        strategy: config.strategy.active,
        stopLoss: exitLevels.stopLoss,
        takeProfit: exitLevels.takeProfit,
      });
    }

    // 🆕 Enregistrer le timestamp du dernier trade pour le cooldown
    this.lastTradeTime.set(pair, Date.now());
    return true;
  }

  private async executeSell(pair: string, signal: StrategySignal, price: number): Promise<boolean> {
    const openTrades = tradeQueries.getOpen(pair);
    if (openTrades.length === 0) return false;

    let executed = false;
    for (const trade of openTrades) {
      await this.closeTrade(trade, price, `Signal ${signal.signal.toUpperCase()} (${signal.reason})`);
      executed = true;
    }
    return executed;
  }

  private async closeTrade(trade: TradeRecord, price: number, reason: string): Promise<void> {
    // 🆕 Nettoyer le trailing stop pour cette paire
    this.riskManager.clearTrailing(trade.pair);

    if (config.trading.mode === 'paper') {
      await this.paperEngine.sell(trade, price, reason);
    } else {
      // Mode LIVE
      const currency = trade.pair.split('-')[0];
      const balance = await this.coinbase.getBalance(currency);

      if (balance > 0) {
        logger.info(`[LIVE] 🔴 VENTE ${trade.pair} @ $${price} | ${reason}`);
        await this.coinbase.placeMarketOrder(trade.pair, 'SELL', balance * price);

        const pnl = (price - trade.entry_price) * trade.quantity;
        const pnlPercent = ((price - trade.entry_price) / trade.entry_price) * 100;

        tradeQueries.close(trade.id, {
          exit_price: price,
          pnl,
          pnl_percent: pnlPercent,
          fees: 0,
          close_reason: reason,
        });

        if (pnl < 0) this.riskManager.recordLoss(Math.abs(pnl));

        // 🆕 Enregistrer le cooldown après une vente aussi
        this.lastTradeTime.set(trade.pair, Date.now());

        await this.notifier.notifyTradeClose({
          pair: trade.pair, side: 'sell', price,
          quantity: trade.quantity,
          amountUSD: trade.amount_usd,
          strategy: trade.strategy,
          pnl, pnlPercent,
          closeReason: reason,
        });
      }
    }
  }

  // =============================================
  // Surveillance des Positions Ouvertes (WebSocket temps réel)
  // =============================================

  private async checkOpenTradesExitConditions(pair: string, currentPrice: number): Promise<void> {
    const openTrades = tradeQueries.getOpen(pair);

    for (const trade of openTrades) {
      const result = this.riskManager.checkExitConditions(trade, currentPrice);

      // 🆕 Mise à jour du trailing stop-loss en base de données
      if (result.newStopLoss && result.newStopLoss > (trade.stop_loss || 0)) {
        tradeQueries.updateStopLoss(trade.id, result.newStopLoss);
        logger.debug(`[${pair}] 📈 SL trailing mis à jour en DB : $${result.newStopLoss.toFixed(2)}`);
      }

      if (result.shouldClose) {
        logger.info(`[${pair}] 🎯 Fermeture automatique : ${result.reason}`);
        await this.closeTrade(trade, currentPrice, result.reason);
      }
    }
  }

  // =============================================
  // Snapshot Portefeuille
  // =============================================

  private async savePortfolioSnapshot(): Promise<void> {
    try {
      const totalValue = config.trading.mode === 'paper'
        ? (() => {
            const pricesMap = new Map<string, number>();
            this.liveprices.forEach((data, pair) => pricesMap.set(pair, data.price));
            return this.paperEngine.getPortfolioValueUSD(pricesMap);
          })()
        : await this.coinbase.getTotalPortfolioValueUSD();

      const cashUSD = config.trading.mode === 'paper'
        ? this.paperEngine.getCashUSD()
        : await this.coinbase.getBalance('USD');

      const openTrades = tradeQueries.getOpen();
      const dailyStats = tradeQueries.getDailyStats();
      const overallStats = tradeQueries.getStats();

      portfolioQueries.insert({
        total_usd: totalValue,
        cash_usd: cashUSD,
        invested_usd: totalValue - cashUSD,
        open_trades: openTrades.length,
        daily_pnl: dailyStats?.total_pnl || 0,
        total_pnl: overallStats?.total_pnl || 0,
      });

      // 🆕 Utiliser la valeur initiale de la config (pas 10000 hardcodé)
      const initialValue = config.trading.paperInitialBalance;
      this.riskManager.setPortfolioValue(initialValue, totalValue);
      logger.debug(`📸 Snapshot portefeuille : $${totalValue.toFixed(2)} (initial: $${initialValue})`);
    } catch (err: any) {
      logger.error('Erreur snapshot portefeuille', { error: err.message });
    }
  }

  // =============================================
  // Utilitaires
  // =============================================

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60_000,
      '5m': 300_000,
      '15m': 900_000,
      '30m': 1_800_000,
      '1h': 3_600_000,
      '4h': 14_400_000,
      '1d': 86_400_000,
    };
    return map[interval] || 900_000; // Défaut : 15 minutes
  }

  getLivePrices(): Map<string, { price: number; change24h?: number }> {
    return this.liveprices;
  }
}
