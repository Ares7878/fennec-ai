import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';

// =============================================
// Types
// =============================================
export interface TradeNotification {
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  amountUSD: number;
  strategy: string;
  stopLoss?: number;
  takeProfit?: number;
  pnl?: number;
  pnlPercent?: number;
  closeReason?: string;
}

export interface DailyReport {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  totalFees: number;
  portfolioValue: number;
  dailyChange: number;
}

// =============================================
// Phrases du Fennec
// =============================================
const fennecPhrases = {
  achat: [
    "J'ai flairé une opportunité avec mes grandes oreilles ! 🦊",
    "Le marché est appétissant, j'attaque la proie ! 🍗",
    "Ça sent le profit à plein nez, je lance l'ordre !",
    "Attention, le Fennec passe à l'action sur le marché !",
    "Opportunité détectée, mes moustaches vibrent de plaisir !"
  ],
  analyse: [
    "Je rôde dans le terrier en attendant le bon moment...",
    "Je surveille les courbes, quel calme plat.",
    "Le marché est comme une nuit dans le désert, je reste aux aguets.",
    "Pour le moment ça pue sur tous les marchés, je me casse !",
    "Je peaufine mes calculs, la chasse sera bonne !",
    "Je reste tapis dans l'ombre, je ne sors pas pour rien."
  ],
  perte: [
    "C'est la faute de la connexion, j'ai glissé sur une dune ! 😅",
    "Le marché est mal luné aujourd'hui, grrr...",
    "C'est la faute de Donald Trump, il fout la merde sur les marchés ce connard !",
    "Oups, j'ai confondu un caillou avec une proie, je me replie.",
    "La volatilité m'a fait perdre le Nord, je me recalibre.",
    "Le Fennec a été surpris, je rentre soigner mes blessures."
  ]
};

export function getRandomPhrase(type: keyof typeof fennecPhrases): string {
  const phrases = fennecPhrases[type];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

// =============================================
// Module Telegram Notifier
// =============================================
export class TelegramNotifier {
  private bot: TelegramBot;
  private chatId: string;
  private commandHandlers: Map<string, () => Promise<string>> = new Map();

  constructor() {
    this.chatId = config.telegram.chatId;
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.setupCommandHandlers();
    logger.info('📱 Bot Telegram initialisé');
  }

  // =============================================
  // Configuration des Commandes Telegram
  // =============================================
  private setupCommandHandlers(): void {
    // /start — Message de bienvenue
    this.bot.onText(/\/start/, async (msg) => {
      const welcome = this.formatMessage(
        '🦊 *Fennec AI — Bot de Trading*',
        [
          'Bonjour ! Je suis votre assistant de trading.',
          '',
          '📋 *Commandes disponibles :*',
          '/status — État du bot et du portefeuille',
          '/trades — Derniers trades',
          '/pnl — Profit & Perte du jour',
          '/portfolio — Vue du portefeuille',
          '/pause — Mettre le bot en pause',
          '/resume — Reprendre le trading',
          '/help — Aide complète',
        ].join('\n')
      );
      await this.sendMessage(welcome);
    });

    // /status
    this.bot.onText(/\/status/, async (msg) => {
      if (this.commandHandlers.has('status')) {
        const response = await this.commandHandlers.get('status')!();
        await this.sendMessage(response);
      }
    });

    // /trades
    this.bot.onText(/\/trades/, async (msg) => {
      if (this.commandHandlers.has('trades')) {
        const response = await this.commandHandlers.get('trades')!();
        await this.sendMessage(response);
      }
    });

    // /pnl
    this.bot.onText(/\/pnl/, async (msg) => {
      if (this.commandHandlers.has('pnl')) {
        const response = await this.commandHandlers.get('pnl')!();
        await this.sendMessage(response);
      }
    });

    // /portfolio
    this.bot.onText(/\/portfolio/, async (msg) => {
      if (this.commandHandlers.has('portfolio')) {
        const response = await this.commandHandlers.get('portfolio')!();
        await this.sendMessage(response);
      }
    });

    // /pause
    this.bot.onText(/\/pause/, async (msg) => {
      if (this.commandHandlers.has('pause')) {
        const response = await this.commandHandlers.get('pause')!();
        await this.sendMessage(response);
      }
    });

    // /resume
    this.bot.onText(/\/resume/, async (msg) => {
      if (this.commandHandlers.has('resume')) {
        const response = await this.commandHandlers.get('resume')!();
        await this.sendMessage(response);
      }
    });

    // Gestion des erreurs de polling
    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error', { error: error.message });
    });
  }

  /**
   * Enregistre un handler pour une commande personnalisée
   */
  registerCommand(command: string, handler: () => Promise<string>): void {
    this.commandHandlers.set(command, handler);
  }

  // =============================================
  // Envoi de Messages
  // =============================================

  /**
   * Envoie un message formaté en Markdown
   */
  async sendMessage(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.chatId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (err: any) {
      logger.error('Erreur envoi Telegram', { error: err.message });
    }
  }

  // =============================================
  // Notifications Spécialisées
  // =============================================

  /**
   * 🟢 Notification d'ouverture de trade
   */
  async notifyTradeOpen(trade: TradeNotification): Promise<void> {
    const emoji = trade.side === 'buy' ? '🟢' : '🔴';
    const sideLabel = trade.side === 'buy' ? 'ACHAT' : 'VENTE';
    
    const lines = [
      `${emoji} *${sideLabel} — ${trade.pair}*`,
      `_${trade.side === 'buy' ? getRandomPhrase('achat') : ''}_`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 Prix : *$${this.fmt(trade.price)}*`,
      `📊 Quantité : ${trade.quantity.toFixed(6)}`,
      `💵 Montant : *$${this.fmt(trade.amountUSD)}*`,
      `🧠 Stratégie : ${trade.strategy.toUpperCase()}`,
    ];

    if (trade.stopLoss) {
      lines.push(`🛑 Stop-Loss : $${this.fmt(trade.stopLoss)} (${this.pct(trade.stopLoss, trade.price)})`);
    }
    if (trade.takeProfit) {
      lines.push(`🎯 Take-Profit : $${this.fmt(trade.takeProfit)} (${this.pct(trade.takeProfit, trade.price)})`);
    }

    lines.push(`⏰ ${new Date().toLocaleString('fr-FR')}`);
    await this.sendMessage(lines.join('\n'));
  }

  /**
   * 🔵 Notification de fermeture de trade
   */
  async notifyTradeClose(trade: TradeNotification): Promise<void> {
    const pnl = trade.pnl || 0;
    const pnlPercent = trade.pnlPercent || 0;
    const emoji = pnl >= 0 ? '✅' : '❌';
    const pnlEmoji = pnl >= 0 ? '📈' : '📉';

    const lines = [
      `${emoji} *TRADE FERMÉ — ${trade.pair}*`,
      ...(pnl < 0 ? [`_${getRandomPhrase('perte')}_`] : []),
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 Prix sortie : *$${this.fmt(trade.price)}*`,
      `${pnlEmoji} P&L : *${pnl >= 0 ? '+' : ''}$${this.fmt(pnl)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)*`,
      `📝 Raison : ${trade.closeReason || 'Manuel'}`,
      `⏰ ${new Date().toLocaleString('fr-FR')}`,
    ];

    await this.sendMessage(lines.join('\n'));
  }

  /**
   * ⚠️ Alerte de prix
   */
  async notifyPriceAlert(pair: string, message: string): Promise<void> {
    await this.sendMessage(`⚠️ *Alerte Prix — ${pair}*\n${message}`);
  }

  /**
   * 📊 Rapport quotidien
   */
  async sendDailyReport(report: DailyReport): Promise<void> {
    const winRate = report.totalTrades > 0
      ? ((report.winningTrades / report.totalTrades) * 100).toFixed(1)
      : '0';

    const pnlEmoji = report.totalPnl >= 0 ? '📈' : '📉';
    const changeEmoji = report.dailyChange >= 0 ? '🟢' : '🔴';

    const lines = [
      `🦊 *RAPPORT QUOTIDIEN — ${new Date().toLocaleDateString('fr-FR')}*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📋 *Trading du jour :*`,
      `• Trades : ${report.totalTrades} (✅ ${report.winningTrades} | ❌ ${report.losingTrades})`,
      `• Win Rate : ${winRate}%`,
      `${pnlEmoji} P&L du jour : *${report.totalPnl >= 0 ? '+' : ''}$${this.fmt(report.totalPnl)}*`,
      `• Meilleur trade : +$${this.fmt(report.bestTrade)}`,
      `• Pire trade : -$${this.fmt(Math.abs(report.worstTrade))}`,
      `• Frais payés : $${this.fmt(report.totalFees)}`,
      ``,
      `💼 *Portefeuille :*`,
      `• Valeur totale : *$${this.fmt(report.portfolioValue)}*`,
      `${changeEmoji} Variation 24h : ${report.dailyChange >= 0 ? '+' : ''}${report.dailyChange.toFixed(2)}%`,
      ``,
      `_Fennec AI • ${new Date().toLocaleString('fr-FR')}_`,
    ];

    await this.sendMessage(lines.join('\n'));
  }

  /**
   * 🚨 Alerte critique
   */
  async notifyCriticalError(title: string, error: string): Promise<void> {
    const lines = [
      `🚨 *ALERTE CRITIQUE — Fennec AI*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `*${title}*`,
      `\`\`\``,
      error.substring(0, 300),
      `\`\`\``,
      `⏰ ${new Date().toLocaleString('fr-FR')}`,
    ];
    await this.sendMessage(lines.join('\n'));
  }

  /**
   * 🛑 Alerte Stop-Loss global (drawdown max)
   */
  async notifyEmergencyStop(drawdown: number): Promise<void> {
    const lines = [
      `🛑 *ARRÊT D'URGENCE — Fennec AI*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `Le drawdown maximum de ${(drawdown * 100).toFixed(1)}% a été atteint.`,
      ``,
      `✅ Toutes les positions ont été fermées.`,
      `⏸️ Le bot est en PAUSE automatique.`,
      ``,
      `Tapez /resume pour reprendre manuellement.`,
    ];
    await this.sendMessage(lines.join('\n'));
  }

  /**
   * 🚀 Message de démarrage
   */
  async notifyStartup(mode: string, pairs: string[]): Promise<void> {
    const lines = [
      `🦊 *Fennec AI — Démarré !*`,
      `_${getRandomPhrase('analyse')}_`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🎯 Mode : *${mode.toUpperCase()}${mode === 'paper' ? ' (Simulation)' : ''}*`,
      `📊 Paires : ${pairs.join(', ')}`,
      ``,
      mode === 'paper'
        ? `💡 Mode Paper Trading activé — aucun argent réel n'est utilisé.`
        : `⚠️ Mode LIVE activé — trading avec argent réel.`,
      ``,
      `Tapez /status pour voir l'état du bot.`,
    ];
    await this.sendMessage(lines.join('\n'));
  }

  // =============================================
  // Utilitaires de Formatage
  // =============================================

  private fmt(n: number): string {
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private pct(price: number, reference: number): string {
    const pct = ((price - reference) / reference) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  private formatMessage(title: string, content: string): string {
    return `*${title}*\n━━━━━━━━━━━━━━━━━━━━\n${content}`;
  }

  /**
   * Test de la connexion Telegram
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.sendMessage('🦊 *Fennec AI* — Test de connexion ✅');
      logger.info('✅ Telegram connecté avec succès');
      return true;
    } catch (err: any) {
      logger.error('❌ Échec connexion Telegram', { error: err.message });
      return false;
    }
  }

  stopPolling(): void {
    this.bot.stopPolling();
  }
}
