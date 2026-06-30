import cron from 'node-cron';
import { config } from '../config';
import { logger } from '../utils/logger';
import { TelegramNotifier } from '../notifiers/telegram';
import { TradingEngine } from '../trading/engine';
import { RiskManager } from '../risk/manager';
import { tradeQueries, portfolioQueries } from '../database';

// =============================================
// Scheduler — Tâches Planifiées
// =============================================
export class Scheduler {
  private notifier: TelegramNotifier;
  private engine: TradingEngine;
  private riskManager: RiskManager;
  private jobs: cron.ScheduledTask[] = [];

  constructor(
    notifier: TelegramNotifier,
    engine: TradingEngine,
    riskManager: RiskManager
  ) {
    this.notifier = notifier;
    this.engine = engine;
    this.riskManager = riskManager;
  }

  start(): void {
    this.scheduleDailyReport();
    this.scheduleMidnightReset();
    this.scheduleHealthCheck();
    this.scheduleWeeklyReport();
    logger.info('⏰ Scheduler démarré — tâches planifiées actives');
  }

  stop(): void {
    this.jobs.forEach((job) => job.stop());
    logger.info('⏰ Scheduler arrêté');
  }

  // =============================================
  // Rapport Quotidien
  // =============================================
  private scheduleDailyReport(): void {
    const [hour, minute] = config.reports.dailyTime.split(':');
    const cronExpr = `${minute} ${hour} * * *`;


    const job = cron.schedule(cronExpr, async () => {
      logger.info('📊 Envoi du rapport quotidien...');
      try {
        const dailyStats = tradeQueries.getDailyStats();
        const portfolioSnapshot = portfolioQueries.getLast();
        const prices = this.engine.getLivePrices();

        // Calcul de la valeur portefeuille
        const portfolioValue = portfolioSnapshot?.total_usd || 0;
        const prevSnapshot = portfolioQueries.getHistory(2);
        const prevValue = prevSnapshot.length > 1 ? prevSnapshot[0].total_usd : portfolioValue;
        const dailyChange = prevValue > 0 ? ((portfolioValue - prevValue) / prevValue) * 100 : 0;

        await this.notifier.sendDailyReport({
          totalTrades: dailyStats?.total_trades || 0,
          winningTrades: dailyStats?.winning_trades || 0,
          losingTrades: (dailyStats?.total_trades || 0) - (dailyStats?.winning_trades || 0),
          totalPnl: dailyStats?.total_pnl || 0,
          bestTrade: 0,
          worstTrade: 0,
          totalFees: dailyStats?.total_fees || 0,
          portfolioValue,
          dailyChange,
        });
      } catch (err: any) {
        logger.error('Erreur rapport quotidien', { error: err.message });
      }
    }, { timezone: 'Europe/Paris' });

    this.jobs.push(job);
    logger.info(`📅 Rapport quotidien programmé à ${config.reports.dailyTime}`);
  }

  // =============================================
  // Reset Minuit
  // =============================================
  private scheduleMidnightReset(): void {
    const job = cron.schedule('0 0 * * *', () => {
      logger.info('🌙 Reset minuit — remise à zéro des compteurs journaliers');
      this.riskManager.resetDailyCounters();
    }, { timezone: 'Europe/Paris' });

    this.jobs.push(job);
  }

  // =============================================
  // Health Check (toutes les 5 minutes)
  // =============================================
  private scheduleHealthCheck(): void {
    const job = cron.schedule('*/5 * * * *', async () => {
      try {
        const openTrades = tradeQueries.getOpen();
        const drawdown = this.riskManager.getDrawdown();

        logger.debug(`💓 Health check | Positions: ${openTrades.length} | Drawdown: ${(drawdown * 100).toFixed(2)}%`);

        // Alerte si drawdown élevé (> 75% du max)
        const maxDrawdown = config.trading.maxDrawdown;
        if (drawdown > maxDrawdown * 0.75 && drawdown < maxDrawdown) {
          await this.notifier.notifyPriceAlert(
            'SYSTÈME',
            `⚠️ Drawdown à ${(drawdown * 100).toFixed(1)}% — Limite max : ${(maxDrawdown * 100).toFixed(0)}%`
          );
        }
      } catch (err: any) {
        logger.error('Erreur health check', { error: err.message });
      }
    });

    this.jobs.push(job);
  }

  // =============================================
  // Rapport Hebdomadaire (lundi 08h00)
  // =============================================
  private scheduleWeeklyReport(): void {
    const job = cron.schedule('0 8 * * 1', async () => {
      logger.info('📊 Envoi du rapport hebdomadaire...');
      try {
        const stats = tradeQueries.getStats();
        const history = portfolioQueries.getHistory(7);

        const startValue = history[0]?.total_usd || 0;
        const endValue = history[history.length - 1]?.total_usd || 0;
        const weeklyChange = startValue > 0 ? ((endValue - startValue) / startValue) * 100 : 0;

        const msg = [
          `🦊 *RAPPORT HEBDOMADAIRE — Fennec AI*`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          ``,
          `📋 *Cette semaine :*`,
          `• Trades : ${stats?.total_trades || 0}`,
          `• Win Rate : ${stats?.total_trades > 0 ? ((stats.winning_trades / stats.total_trades) * 100).toFixed(1) : 0}%`,
          `• P&L : ${(stats?.total_pnl || 0) >= 0 ? '+' : ''}$${(stats?.total_pnl || 0).toFixed(2)}`,
          ``,
          `💼 *Portefeuille :*`,
          `• Valeur : $${endValue.toFixed(2)}`,
          `• Variation semaine : ${weeklyChange >= 0 ? '+' : ''}${weeklyChange.toFixed(2)}%`,
        ].join('\n');

        await this.notifier.sendMessage(msg);
      } catch (err: any) {
        logger.error('Erreur rapport hebdomadaire', { error: err.message });
      }
    }, { timezone: 'Europe/Paris' });

    this.jobs.push(job);
    logger.info('📅 Rapport hebdomadaire programmé (lundi 08h00)');
  }
}
