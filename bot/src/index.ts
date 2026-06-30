import 'dotenv/config';
import { config } from './config';
import { logger } from './utils/logger';
import { initDatabase } from './database';
import { CoinbaseConnector } from './connectors/coinbase';
import { TelegramNotifier } from './notifiers/telegram';
import { RiskManager } from './risk/manager';
import { TradingEngine } from './trading/engine';
import { Scheduler } from './scheduler';

// =============================================
// 🦊 FENNEC AI — Point d'Entrée Principal
// =============================================

const BANNER = `
╔═══════════════════════════════════════════╗
║                                           ║
║   🦊  FENNEC AI — Trading Bot v1.0.0     ║
║                                           ║
║   Mode : ${config.trading.mode.toUpperCase().padEnd(6)} | ${config.strategy.active.toUpperCase().padEnd(10)}          ║
║   Paires : ${config.trading.pairs.join(', ').substring(0, 28)}  ║
║                                           ║
╚═══════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  console.log(BANNER);

  // =============================================
  // 1. Initialisation Base de Données
  // =============================================
  logger.info('🗄️  Initialisation de la base de données...');
  await initDatabase();

  // =============================================
  // 2. Initialisation des Connecteurs
  // =============================================
  logger.info('🔌 Connexion à Coinbase...');
  const coinbase = new CoinbaseConnector();

  logger.info('📱 Initialisation du bot Telegram...');
  const notifier = new TelegramNotifier();

  // =============================================
  // 3. Test des Connexions
  // =============================================
  const [coinbaseOk, telegramOk] = await Promise.all([
    coinbase.testConnection(),
    notifier.testConnection(),
  ]);

  if (!coinbaseOk) {
    logger.error('❌ Impossible de se connecter à Coinbase. Vérifiez vos clés API dans .env');
    process.exit(1);
  }

  if (!telegramOk) {
    logger.warn('⚠️  Telegram non disponible — Le bot fonctionnera sans notifications');
  }

  // =============================================
  // 4. Initialisation du Risk Manager
  // =============================================
  logger.info('🛡️  Initialisation du Risk Manager...');
  const riskManager = new RiskManager();

  // =============================================
  // 5. Initialisation du Moteur de Trading
  // =============================================
  logger.info('⚙️  Initialisation du moteur de trading...');
  const engine = new TradingEngine(coinbase, notifier, riskManager);

  // =============================================
  // 6. Démarrage du Scheduler
  // =============================================
  logger.info('⏰ Démarrage du scheduler...');
  const scheduler = new Scheduler(notifier, engine, riskManager);
  scheduler.start();

  // =============================================
  // 7. Démarrage du Moteur de Trading
  // =============================================
  await engine.start();

  // =============================================
  // 8. Notification de Démarrage
  // =============================================
  await notifier.notifyStartup(config.trading.mode, config.trading.pairs);

  logger.info('✅ Fennec AI démarré avec succès !');
  logger.info(`📊 Mode : ${config.trading.mode.toUpperCase()}${config.trading.mode === 'paper' ? ' (Simulation — aucun argent réel)' : ' (LIVE — argent réel !)'}`);
  logger.info(`🎯 Stratégie : ${config.strategy.active}`);
  logger.info(`📈 Paires : ${config.trading.pairs.join(', ')}`);

  // =============================================
  // 9. Gestion de l'Arrêt Propre
  // =============================================
  const shutdown = async (signal: string) => {
    logger.info(`\n⚠️  Signal ${signal} reçu — Arrêt propre en cours...`);

    try {
      scheduler.stop();
      await engine.stop();
      notifier.stopPolling();
      await notifier.sendMessage('🛑 *Fennec AI arrêté proprement.*');
      logger.info('✅ Arrêt propre terminé.');
    } catch (err) {
      logger.error('Erreur lors de l\'arrêt', { error: err });
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Gestion des erreurs non capturées
  process.on('uncaughtException', async (err) => {
    logger.error('❌ Erreur non capturée', { error: err.message, stack: err.stack });
    await notifier.notifyCriticalError('Erreur non capturée', err.message);
  });

  process.on('unhandledRejection', async (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error('❌ Promise rejetée non gérée', { reason: message });
    await notifier.notifyCriticalError('Promise rejetée', message);
  });
}

// Lancement
main().catch(async (err) => {
  console.error('💥 Erreur fatale au démarrage :', err.message);
  logger.error('Erreur fatale', { error: err.message, stack: err.stack });
  process.exit(1);
});
