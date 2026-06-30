import crypto from 'crypto';
function uuidv4() { return crypto.randomUUID(); }
import { config } from '../config';
import { logger } from '../utils/logger';
import { tradeQueries, configQueries, TradeRecord } from '../database';
import { TelegramNotifier } from '../notifiers/telegram';

// =============================================
// Portefeuille Virtuel pour le Paper Trading
// =============================================
interface PaperPortfolio {
  cashUSD: number;
  holdings: Map<string, { quantity: number; avgPrice: number }>;
}

// =============================================
// Moteur de Paper Trading (Simulation)
// =============================================
export class PaperTradingEngine {
  private portfolio: PaperPortfolio;
  private notifier: TelegramNotifier;
  private readonly INITIAL_BALANCE_KEY = 'paper_balance_usd';
  private readonly INITIAL_BALANCE = config.trading.paperInitialBalance; // Capital défini dans .env

  constructor(notifier: TelegramNotifier) {
    this.notifier = notifier;
    this.portfolio = {
      cashUSD: this.loadInitialBalance(),
      holdings: new Map(),
    };
    logger.info(`💸 Paper Trading initialisé — Capital : $${this.portfolio.cashUSD.toFixed(2)}`);
  }

  private loadInitialBalance(): number {
    const saved = configQueries.get(this.INITIAL_BALANCE_KEY);
    return saved ? parseFloat(saved) : this.INITIAL_BALANCE;
  }

  // =============================================
  // Opérations de Trading Simulé
  // =============================================

  /**
   * Simule un ordre d'achat
   */
  async buy(
    pair: string,
    price: number,
    amountUSD: number,
    strategy: string,
    stopLoss: number,
    takeProfit: number,
    signalData?: object
  ): Promise<TradeRecord | null> {
    const currency = pair.split('-')[0]; // Ex: BTC de BTC-USD

    // Vérification du capital disponible
    const fee = amountUSD * 0.006; // 0.6% de frais simulés
    const totalCost = amountUSD + fee;

    if (totalCost > this.portfolio.cashUSD) {
      logger.warn(`[PAPER] Fonds insuffisants : besoin $${totalCost.toFixed(2)}, disponible $${this.portfolio.cashUSD.toFixed(2)}`);
      return null;
    }

    const quantity = amountUSD / price;

    // Mise à jour du portefeuille virtuel
    this.portfolio.cashUSD -= totalCost;
    const existing = this.portfolio.holdings.get(currency);
    if (existing) {
      const totalQty = existing.quantity + quantity;
      existing.avgPrice = (existing.avgPrice * existing.quantity + price * quantity) / totalQty;
      existing.quantity = totalQty;
    } else {
      this.portfolio.holdings.set(currency, { quantity, avgPrice: price });
    }

    // Sauvegarde en DB
    const orderId = `paper-${uuidv4()}`;
    const tradeId = tradeQueries.insert({
      order_id: orderId,
      pair,
      side: 'buy',
      mode: 'paper',
      strategy,
      entry_price: price,
      quantity,
      amount_usd: amountUSD,
      fees: fee,
      pnl: 0,
      pnl_percent: 0,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: 'open',
      signal_data: signalData ? JSON.stringify(signalData) : undefined,
    });

    logger.info(`[PAPER] ✅ ACHAT ${pair} | Prix: $${price} | Qté: ${quantity.toFixed(6)} | Montant: $${amountUSD.toFixed(2)}`);

    // Notification Telegram
    await this.notifier.notifyTradeOpen({
      pair,
      side: 'buy',
      price,
      quantity,
      amountUSD,
      strategy,
      stopLoss,
      takeProfit,
    });

    return tradeQueries.getOpen(pair)[0];
  }

  /**
   * Simule un ordre de vente
   */
  async sell(
    trade: TradeRecord,
    currentPrice: number,
    reason: string
  ): Promise<void> {
    const currency = trade.pair.split('-')[0];
    const holding = this.portfolio.holdings.get(currency);

    if (!holding || holding.quantity < trade.quantity) {
      logger.warn(`[PAPER] Pas de position à vendre pour ${trade.pair}`);
      return;
    }

    const grossRevenue = trade.quantity * currentPrice;
    const fee = grossRevenue * 0.006;
    const netRevenue = grossRevenue - fee;

    const pnl = netRevenue - trade.amount_usd - trade.fees;
    const pnlPercent = (pnl / trade.amount_usd) * 100;

    // Mise à jour du portefeuille
    this.portfolio.cashUSD += netRevenue;
    holding.quantity -= trade.quantity;
    if (holding.quantity < 0.00001) {
      this.portfolio.holdings.delete(currency);
    }

    // Mise à jour de la balance persistante
    configQueries.set(this.INITIAL_BALANCE_KEY, this.portfolio.cashUSD.toFixed(2));

    // Fermeture en DB
    tradeQueries.close(trade.id, {
      exit_price: currentPrice,
      pnl,
      pnl_percent: pnlPercent,
      fees: fee,
      close_reason: reason,
    });

    const emoji = pnl >= 0 ? '🟢' : '🔴';
    logger.info(`[PAPER] ${emoji} VENTE ${trade.pair} | Prix: $${currentPrice} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | ${reason}`);

    // Notification Telegram
    await this.notifier.notifyTradeClose({
      pair: trade.pair,
      side: 'sell',
      price: currentPrice,
      quantity: trade.quantity,
      amountUSD: trade.amount_usd,
      strategy: trade.strategy,
      pnl,
      pnlPercent,
      closeReason: reason,
    });
  }

  // =============================================
  // Informations du Portefeuille
  // =============================================

  getPortfolioValueUSD(prices: Map<string, number>): number {
    let total = this.portfolio.cashUSD;

    this.portfolio.holdings.forEach((holding, currency) => {
      const price = prices.get(`${currency}-USD`) || 0;
      total += holding.quantity * price;
    });

    return total;
  }

  getCashUSD(): number {
    return this.portfolio.cashUSD;
  }

  getHoldings(): Map<string, { quantity: number; avgPrice: number }> {
    return this.portfolio.holdings;
  }

  getSummary(prices: Map<string, number>): string {
    const totalValue = this.getPortfolioValueUSD(prices);
    const invested = totalValue - this.portfolio.cashUSD;
    const totalPnl = totalValue - this.INITIAL_BALANCE;
    const pnlPct = (totalPnl / this.INITIAL_BALANCE) * 100;

    const lines = [
      `💼 *Portefeuille Paper Trading*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 Valeur totale : *$${totalValue.toFixed(2)}*`,
      `💵 Cash disponible : $${this.portfolio.cashUSD.toFixed(2)}`,
      `📊 Investi : $${invested.toFixed(2)}`,
      `${totalPnl >= 0 ? '📈' : '📉'} P&L total : *${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${pnlPct.toFixed(2)}%)*`,
    ];

    if (this.portfolio.holdings.size > 0) {
      lines.push(`\n📦 *Positions ouvertes :*`);
      this.portfolio.holdings.forEach((h, currency) => {
        const currentPrice = prices.get(`${currency}-USD`) || h.avgPrice;
        const value = h.quantity * currentPrice;
        const tradePnl = (currentPrice - h.avgPrice) / h.avgPrice * 100;
        lines.push(`• ${currency}: ${h.quantity.toFixed(6)} | $${value.toFixed(2)} | ${tradePnl >= 0 ? '+' : ''}${tradePnl.toFixed(2)}%`);
      });
    }

    return lines.join('\n');
  }
}
