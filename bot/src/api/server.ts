import express from 'express';
import cors from 'cors';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  tradeQueries, portfolioQueries, signalQueries,
} from '../database';
import { TradingEngine } from '../trading/engine';
import { RiskManager } from '../risk/manager';

// =============================================
// 🦊 Fennec AI — Serveur API REST
// Pour le dashboard fennec.eldzayer.com
// =============================================

// Temps de démarrage (pour l'uptime)
const startTime = Date.now();

export function createApiServer(
  engine: TradingEngine,
  riskManager: RiskManager,
): express.Application {
  const app = express();

  // =============================================
  // Middlewares
  // =============================================
  app.use(express.json());

  // CORS — autorise le dashboard O2Switch
  app.use(cors({
    origin: [
      'https://fennec.eldzayer.com',
      'http://fennec.eldzayer.com',
      'http://localhost:5173',
      'http://localhost:4173',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
    credentials: false,
  }));

  // Middleware d'authentification par clé API
  const apiKey = config.api.secretKey;
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    // Si pas de clé configurée (valeur par défaut) → accès libre (dev)
    if (apiKey === 'change_me_in_production') {
      return next();
    }
    const key = req.headers['x-api-key'];
    if (!key || key !== apiKey) {
      return res.status(401).json({ error: 'Clé API invalide' });
    }
    return next();
  }

  // =============================================
  // Route : Health check public (pas d'auth)
  // =============================================
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) });
  });

  // =============================================
  // Routes API (authentifiées)
  // =============================================

  // GET /api/status — État complet du bot
  app.get('/api/status', requireAuth, (req, res) => {
    try {
      const riskStatus = riskManager.getStatus() as any;
      const prices = engine.getLivePrices();
      const pricesObj: Record<string, number> = {};
      prices.forEach((data, pair) => { pricesObj[pair] = data.price; });

      res.json({
        running: true,
        paused: riskStatus.paused,
        emergencyStopped: riskStatus.emergencyStopped,
        mode: config.trading.mode,
        strategy: config.strategy.active,
        pairs: config.trading.pairs,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        drawdown: riskManager.getDrawdown(),
        dailyLoss: riskStatus.dailyLoss,
        limits: riskStatus.limits,
        prices: pricesObj,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/prices — Prix live des cryptos
  app.get('/api/prices', requireAuth, (req, res) => {
    try {
      const prices = engine.getLivePrices();
      const result: any[] = [];
      prices.forEach((data, pair) => {
        result.push({
          pair,
          price: data.price,
          change24h: data.change24h,
          lastUpdated: new Date().toISOString(),
        });
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/portfolio — Portefeuille actuel
  app.get('/api/portfolio', requireAuth, (req, res) => {
    try {
      const snapshot = portfolioQueries.getLast();
      const openTrades = tradeQueries.getOpen();
      const overallStats = tradeQueries.getStats();
      const dailyStats = tradeQueries.getDailyStats();

      res.json({
        total_usd: snapshot?.total_usd || config.trading.paperInitialBalance,
        cash_usd: snapshot?.cash_usd || config.trading.paperInitialBalance,
        invested_usd: snapshot?.invested_usd || 0,
        open_trades: openTrades.length,
        daily_pnl: dailyStats?.total_pnl || 0,
        total_pnl: overallStats?.total_pnl || 0,
        initial_balance: config.trading.paperInitialBalance,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/portfolio/history — Historique snapshots
  app.get('/api/portfolio/history', requireAuth, (req, res) => {
    try {
      const days = parseInt((req.query.days as string) || '7');
      const history = portfolioQueries.getHistory(Math.min(days, 90));
      res.json(history.map(h => ({
        timestamp: h.snapshot_at,
        total_usd: h.total_usd,
        daily_pnl: h.daily_pnl,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trades — Historique des trades
  app.get('/api/trades', requireAuth, (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '50');
      const trades = tradeQueries.getAll(Math.min(limit, 200));
      res.json(trades);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trades/open — Positions ouvertes
  app.get('/api/trades/open', requireAuth, (req, res) => {
    try {
      const openTrades = tradeQueries.getOpen();
      const prices = engine.getLivePrices();

      // Enrichir avec le P&L non réalisé
      const enriched = openTrades.map(t => {
        const currentPrice = prices.get(t.pair)?.price || t.entry_price;
        const unrealizedPnl = (currentPrice - t.entry_price) * t.quantity;
        const unrealizedPct = ((currentPrice - t.entry_price) / t.entry_price) * 100;
        return {
          ...t,
          current_price: currentPrice,
          unrealized_pnl: unrealizedPnl,
          unrealized_pct: unrealizedPct,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/stats — Statistiques globales
  app.get('/api/stats', requireAuth, (req, res) => {
    try {
      const overall = tradeQueries.getStats();
      const daily = tradeQueries.getDailyStats();
      const winRate = overall.total_trades > 0
        ? (overall.winning_trades / overall.total_trades) * 100
        : 0;

      res.json({
        total_trades: overall.total_trades,
        winning_trades: overall.winning_trades,
        losing_trades: overall.total_trades - overall.winning_trades,
        total_pnl: overall.total_pnl || 0,
        total_fees: overall.total_fees || 0,
        best_trade: overall.best_trade || 0,
        worst_trade: overall.worst_trade || 0,
        win_rate: winRate,
        avg_pnl: overall.avg_pnl_percent || 0,
        daily: {
          trades: daily?.total_trades || 0,
          pnl: daily?.total_pnl || 0,
          fees: daily?.total_fees || 0,
          best: daily?.best_trade || 0,
          worst: daily?.worst_trade || 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/signals — Derniers signaux
  app.get('/api/signals', requireAuth, (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '30');
      const pairs = config.trading.pairs;

      const allSignals: any[] = [];
      for (const pair of pairs) {
        const signals = signalQueries.getRecent(pair, Math.ceil(limit / pairs.length));
        allSignals.push(...signals);
      }

      // Trier par date décroissante
      allSignals.sort((a, b) =>
        new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
      );

      res.json(allSignals.slice(0, limit).map(s => ({
        id: s.id,
        pair: s.pair,
        strategy: s.strategy,
        signal: s.signal,
        strength: s.strength,
        price: s.price,
        acted_on: s.acted_on === 1,
        created_at: s.generated_at,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // =============================================
  // Routes de Contrôle (POST)
  // =============================================

  // POST /api/bot/pause
  app.post('/api/bot/pause', requireAuth, (req, res) => {
    try {
      riskManager.pause();
      logger.info('⏸️ Bot mis en pause via API dashboard');
      res.json({ success: true, message: 'Bot mis en pause' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bot/resume
  app.post('/api/bot/resume', requireAuth, (req, res) => {
    try {
      riskManager.resume();
      logger.info('▶️ Bot repris via API dashboard');
      res.json({ success: true, message: 'Bot repris' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bot/strategy — Note: ne change pas la stratégie en live
  // (nécessite redémarrage), mais renvoie la config actuelle
  app.post('/api/bot/strategy', requireAuth, (req, res) => {
    const { strategy } = req.body;
    const valid = ['rsi', 'macd', 'ema_cross', 'bollinger', 'consensus'];
    if (!valid.includes(strategy)) {
      return res.status(400).json({ error: `Stratégie invalide. Utilisez : ${valid.join(', ')}` });
    }
    logger.info(`📊 Changement de stratégie demandé via dashboard : ${strategy} (immédiatement effectif)`);
    config.strategy.active = strategy as any;
    engine.reloadStrategies();

    res.json({
      success: true,
      message: `Stratégie ${strategy} activée avec succès !`,
      current: config.strategy.active,
      requested: strategy,
    });
  });

  // 404 pour routes inconnues
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route inconnue' });
  });

  return app;
}

// Démarre le serveur sur le port configuré
export function startApiServer(
  engine: TradingEngine,
  riskManager: RiskManager,
): void {
  const app = createApiServer(engine, riskManager);
  // Railway injecte automatiquement PORT
  const port = parseInt(process.env.PORT || String(config.api.port));

  app.listen(port, '0.0.0.0', () => {
    logger.info(`🌐 API Server démarré sur le port ${port}`);
    logger.info(`🔗 Health: http://0.0.0.0:${port}/health`);
  });
}
