import Alpaca from '@alpacahq/alpaca-trade-api';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class AlpacaConnector {
  private alpaca: any;
  private wsConnected = false;

  constructor() {
    this.alpaca = new Alpaca({
      keyId: config.alpaca.apiKey,
      secretKey: config.alpaca.apiSecret,
      paper: true, // Toujours en paper trading pour tester d'abord
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const account = await this.alpaca.getAccount();
      logger.info(`✅ Connexion Alpaca OK! Statut: ${account.status}, Balance: $${account.portfolio_value}`);
      return true;
    } catch (e: any) {
      logger.error(`❌ Erreur connexion Alpaca: ${e.message}`);
      return false;
    }
  }

  async isMarketOpen(): Promise<boolean> {
    try {
      const clock = await this.alpaca.getClock();
      return clock.is_open;
    } catch (e) {
      return false;
    }
  }

  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    try {
      // Mapping interval ('15m', '1h', '1d') to Alpaca timeframe ('15Min', '1Hour', '1Day')
      let timeframe = '15Min';
      if (interval === '1h') timeframe = '1Hour';
      if (interval === '1d') timeframe = '1Day';

      // Alpaca API v2 bars (historique)
      const bars = await this.alpaca.getBarsV2(symbol, {
        timeframe,
        limit,
      });

      const candles: Candle[] = [];
      for await (let bar of bars) {
        candles.push({
          timestamp: new Date(bar.Timestamp),
          open: bar.OpenPrice,
          high: bar.HighPrice,
          low: bar.LowPrice,
          close: bar.ClosePrice,
          volume: bar.Volume,
        });
      }
      return candles;
    } catch (e: any) {
      logger.error(`Erreur getCandles Alpaca (${symbol}): ${e.message}`);
      return [];
    }
  }

  async getBalance(currency: string = 'USD'): Promise<number> {
    try {
      const account = await this.alpaca.getAccount();
      // En bourse, le compte est généralement en USD.
      if (currency === 'USD') {
        return parseFloat(account.buying_power);
      }
      // Si on demande la balance d'un actif (ex: 'AAPL')
      const position = await this.alpaca.getPosition(currency);
      return parseFloat(position.qty);
    } catch (e) {
      // Pas de position existante = 0
      return 0;
    }
  }

  async getTotalPortfolioValueUSD(): Promise<number> {
    try {
      const account = await this.alpaca.getAccount();
      return parseFloat(account.portfolio_value);
    } catch (e) {
      return 0;
    }
  }

  async placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', amountUsd: number): Promise<any> {
    try {
      // Note: Alpaca permet les achats de fractions d'actions (notional)
      const order = await this.alpaca.createOrder({
        symbol,
        notional: amountUsd, // Montant en dollars
        side: side.toLowerCase(),
        type: 'market',
        time_in_force: 'day',
      });
      logger.info(`✅ Ordre ${side} Alpaca exécuté sur ${symbol} pour $${amountUsd}`);
      return order;
    } catch (e: any) {
      logger.error(`❌ Erreur ordre Alpaca (${symbol} - ${side}): ${e.message}`);
      throw e;
    }
  }

  subscribeToTicker(pairs: string[], onTick: (pair: string, price: number, change24h: number) => void) {
    logger.info(`🔌 Démarrage du WebSocket Alpaca pour: ${pairs.join(', ')}`);
    
    // Fallback: Polling basique vu que IEX data n'a pas toujours le 24h change facile en WS.
    setInterval(async () => {
      try {
        const isOp = await this.isMarketOpen();
        if(!isOp) return; // Ne pas poll si le marché est fermé

        const snapshots = await this.alpaca.getSnapshots(pairs);
        for (const snap of snapshots) {
          if (snap) {
            const pair = snap.symbol;
            if (!pairs.includes(pair)) continue;

            let price = 0;
            if (snap.LatestTrade && snap.LatestTrade.Price > 0) {
              price = snap.LatestTrade.Price;
            } else if (snap.LatestQuote && snap.LatestQuote.AskPrice > 0) {
              price = snap.LatestQuote.AskPrice;
            } else if (snap.MinuteBar && snap.MinuteBar.ClosePrice > 0) {
              price = snap.MinuteBar.ClosePrice;
            }

            if (price > 0) {
              const prevClose = snap.PrevDailyBar ? snap.PrevDailyBar.ClosePrice : price;
              const change24h = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
              onTick(pair, price, change24h);
            }
          }
        }
      } catch (e: any) {
        logger.error(`Erreur polling Alpaca: ${e.message}`);
      }
    }, 10000); // 10 secondes
  }

  closeWebSocket() {
    this.wsConnected = false;
  }
}
