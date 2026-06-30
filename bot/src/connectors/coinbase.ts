import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../utils/logger';

// =============================================
// Types Coinbase Advanced Trade API
// =============================================
export interface CoinbaseProduct {
  product_id: string;
  base_currency_id: string;
  quote_currency_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  volume_percentage_change_24h: string;
  base_min_size: string;
  base_max_size: string;
  base_increment: string;
  quote_increment: string;
  status: string;
}

export interface CoinbaseCandle {
  start: string;
  low: string;
  high: string;
  open: string;
  close: string;
  volume: string;
}

export interface CoinbaseOrder {
  order_id: string;
  product_id: string;
  side: 'BUY' | 'SELL';
  status: string;
  filled_size: string;
  average_filled_price: string;
  total_fees: string;
  created_time: string;
}

export interface AccountBalance {
  currency: string;
  available_balance: string;
  hold: string;
}

export interface Ticker {
  price: string;
  best_bid: string;
  best_ask: string;
  trade_id: string;
  size: string;
  time: string;
}

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// =============================================
// Authentification Coinbase (Support Legacy HMAC + CDP JWT)
// =============================================
function signRequest(method: string, requestPath: string, body: string = ''): Record<string, string> {
  let apiKey = config.coinbase.apiKey.trim();
  let apiSecret = config.coinbase.apiSecret.trim();

  // ==========================================
  // SECURITE ULTIME : Extracteur Regex
  // ==========================================
  const pemMatch = apiSecret.match(/-----BEGIN EC PRIVATE KEY-----(.*?)-----END EC PRIVATE KEY-----/is);
  const nameMatch = apiSecret.match(/"name"\s*:\s*"([^"]+)"/i);

  // Si l'utilisateur a collé le JSON dans le secret, on extrait le nom et la clé
  if (nameMatch) {
    apiKey = nameMatch[1];
    
    // Si ce n'est PAS un PEM (ex: ancienne clé HMAC), on récupère la valeur brute depuis le JSON
    if (!pemMatch) {
      const secretMatch = apiSecret.match(/"privateKey"\s*:\s*"([^"]+)"/i);
      if (secretMatch) {
        apiSecret = secretMatch[1];
      }
    }
  }

  // Détection VRAIE de la clé : si on a un PEM, c'est du CDP (JWT). Sinon c'est du Legacy (HMAC).
  const isCDP = !!pemMatch;

  if (isCDP) {
    logger.info("✅ Format de clé privée CDP (JWT) détecté !");
    
    // Nettoyage agressif du corps du PEM
    let rawSecret = pemMatch![1]
      .replace(/\\\\n/g, '')
      .replace(/\\n/g, '')
      .replace(/\s/g, '')
      .replace(/"/g, '')
      .replace(/\\/g, '');

    // Reconstruction parfaite de la clé PEM
    const formattedBody = rawSecret.match(/.{1,64}/g)?.join('\n') || rawSecret;
    const finalSecret = `-----BEGIN EC PRIVATE KEY-----\n${formattedBody}\n-----END EC PRIVATE KEY-----\n`;

    const token = jwt.sign(
      {
        iss: 'coinbase-cloud',
        nbf: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 120,
        sub: apiKey,
      },
      finalSecret,
      {
        algorithm: 'ES256',
        header: {
          kid: apiKey,
          nonce: crypto.randomBytes(16).toString('hex'),
        } as any
      }
    );

    return {
      'Authorization': `Bearer ${token}`
    };
  } else {
    logger.info("✅ Format de clé Legacy (HMAC) détecté !");
    
    // Legacy API Key (HMAC)
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sigInput = timestamp + method.toUpperCase() + requestPath + body;
    
    let decodedSecret: Buffer;
    try {
      decodedSecret = Buffer.from(apiSecret, 'base64');
    } catch (e) {
      decodedSecret = Buffer.from(apiSecret);
    }
    
    const signature = crypto
      .createHmac('sha256', decodedSecret)
      .update(sigInput)
      .digest('base64');

    return {
      'CB-ACCESS-KEY': apiKey,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
    };
  }
}

// =============================================
// Connecteur Coinbase Advanced Trade (CDP/JWT)
// =============================================
export class CoinbaseConnector {
  private http: AxiosInstance;
  private ws: WebSocket | null = null;
  private priceCallbacks: Map<string, ((price: number) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 10;

  constructor() {
    this.http = axios.create({
      baseURL: config.coinbase.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FennecAI/1.0',
      },
    });

    // Intercepteur JWT/HMAC — signe chaque requête
    this.http.interceptors.request.use((req) => {
      const method = (req.method || 'GET').toUpperCase();
      const path = req.url || '';
      const body = req.data ? JSON.stringify(req.data) : '';
      
      const authHeaders = signRequest(method, path, body);
      Object.assign(req.headers, authHeaders);
      
      return req;
    });
  }

  // =============================================
  // Informations Marché
  // =============================================

  /**
   * Récupère le prix actuel d'une paire
   */
  async getPrice(pair: string): Promise<number> {
    try {
      const { data } = await this.http.get(`/api/v3/brokerage/products/${pair}`);
      return parseFloat(data.price);
    } catch (err: any) {
      logger.error(`Erreur getPrice ${pair}`, { error: err.message });
      throw err;
    }
  }

  /**
   * Récupère les données de chandeliers (OHLCV)
   */
  async getCandles(pair: string, interval: string, limit = 300): Promise<Candle[]> {
    const granularityMap: Record<string, string> = {
      '1m': 'ONE_MINUTE',
      '5m': 'FIVE_MINUTE',
      '15m': 'FIFTEEN_MINUTE',
      '30m': 'THIRTY_MINUTE',
      '1h': 'ONE_HOUR',
      '2h': 'TWO_HOUR',
      '6h': 'SIX_HOUR',
      '1d': 'ONE_DAY',
    };

    const granularity = granularityMap[interval] || 'FIFTEEN_MINUTE';
    const end = Math.floor(Date.now() / 1000);
    const granularitySeconds: Record<string, number> = {
      ONE_MINUTE: 60, FIVE_MINUTE: 300, FIFTEEN_MINUTE: 900,
      THIRTY_MINUTE: 1800, ONE_HOUR: 3600, TWO_HOUR: 7200,
      SIX_HOUR: 21600, ONE_DAY: 86400,
    };
    const start = end - (limit * (granularitySeconds[granularity] || 900));

    try {
      const { data } = await this.http.get(`/api/v3/brokerage/products/${pair}/candles`, {
        params: { start, end, granularity },
      });

      return (data.candles as CoinbaseCandle[])
        .map((c) => ({
          timestamp: new Date(parseInt(c.start) * 1000),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume),
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (err: any) {
      logger.error(`Erreur getCandles ${pair}`, { error: err.message });
      throw err;
    }
  }

  /**
   * Récupère les informations d'un produit
   */
  async getProduct(pair: string): Promise<CoinbaseProduct> {
    const { data } = await this.http.get(`/api/v3/brokerage/products/${pair}`);
    return data;
  }

  // =============================================
  // Gestion du Portefeuille
  // =============================================

  /**
   * Récupère tous les soldes du compte
   */
  async getBalances(): Promise<AccountBalance[]> {
    try {
      const { data } = await this.http.get('/api/v3/brokerage/accounts');
      return data.accounts.map((a: any) => ({
        currency: a.currency,
        available_balance: a.available_balance.value,
        hold: a.hold.value,
      }));
    } catch (err: any) {
      logger.error('Erreur getBalances', { error: err.message });
      throw err;
    }
  }

  /**
   * Récupère le solde d'une devise spécifique
   */
  async getBalance(currency: string): Promise<number> {
    const balances = await this.getBalances();
    const balance = balances.find((b) => b.currency === currency);
    return balance ? parseFloat(balance.available_balance) : 0;
  }

  /**
   * Calcule la valeur totale du portefeuille en USD
   */
  async getTotalPortfolioValueUSD(): Promise<number> {
    const balances = await this.getBalances();
    let totalUSD = 0;

    for (const balance of balances) {
      const amount = parseFloat(balance.available_balance);
      if (amount === 0) continue;

      if (balance.currency === 'USD') {
        totalUSD += amount;
      } else {
        try {
          const price = await this.getPrice(`${balance.currency}-USD`);
          totalUSD += amount * price;
        } catch {
          // Ignore les cryptos sans paire USD
        }
      }
    }

    return totalUSD;
  }

  // =============================================
  // Placement d'Ordres
  // =============================================

  /**
   * Place un ordre Market (LIVE uniquement)
   */
  async placeMarketOrder(
    pair: string,
    side: 'BUY' | 'SELL',
    amountUSD: number
  ): Promise<CoinbaseOrder> {
    const clientOrderId = `fennec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const orderConfig = side === 'BUY'
      ? { market_market_ioc: { quote_size: amountUSD.toFixed(2) } }
      : { market_market_ioc: { base_size: amountUSD.toFixed(8) } };

    const body = {
      client_order_id: clientOrderId,
      product_id: pair,
      side,
      order_configuration: orderConfig,
    };

    try {
      const { data } = await this.http.post('/api/v3/brokerage/orders', body);
      logger.info(`✅ Ordre placé : ${side} ${pair} $${amountUSD}`, { orderId: data.order_id });
      return data;
    } catch (err: any) {
      logger.error(`Erreur placeOrder ${side} ${pair}`, { error: err.response?.data || err.message });
      throw err;
    }
  }

  /**
   * Récupère un ordre par son ID
   */
  async getOrder(orderId: string): Promise<CoinbaseOrder> {
    const { data } = await this.http.get(`/api/v3/brokerage/orders/historical/${orderId}`);
    return data.order;
  }

  /**
   * Annule un ordre en attente
   */
  async cancelOrder(orderId: string): Promise<void> {
    await this.http.post('/api/v3/brokerage/orders/batch_cancel', {
      order_ids: [orderId],
    });
    logger.info(`🚫 Ordre annulé : ${orderId}`);
  }

  // =============================================
  // WebSocket — Prix en Temps Réel
  // =============================================

  /**
   * S'abonne aux prix en temps réel pour une ou plusieurs paires
   * Note: le WebSocket Coinbase Advanced Trade utilise aussi la signature JWT
   */
  subscribeToTicker(pairs: string[], onPrice: (pair: string, price: number) => void): void {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(config.coinbase.wsUrl);

    this.ws.on('open', () => {
      logger.info(`📡 WebSocket connecté — abonnement à ${pairs.join(', ')}`);
      this.reconnectAttempts = 0;

      const authHeaders = signRequest('GET', '/');
      const isJWT = 'Authorization' in authHeaders;

      const subscribeMsg: any = {
        type: 'subscribe',
        product_ids: pairs,
        channel: 'ticker',
      };

      if (isJWT) {
        subscribeMsg.jwt = authHeaders['Authorization'].replace('Bearer ', '');
      } else {
        subscribeMsg.api_key = authHeaders['CB-ACCESS-KEY'];
        subscribeMsg.signature = authHeaders['CB-ACCESS-SIGN'];
        subscribeMsg.timestamp = authHeaders['CB-ACCESS-TIMESTAMP'];
      }

      this.ws!.send(JSON.stringify(subscribeMsg));
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.channel === 'ticker' && msg.events) {
          for (const event of msg.events) {
            for (const tick of (event.tickers || [])) {
              const price = parseFloat(tick.price);
              if (price > 0) {
                onPrice(tick.product_id, price);
              }
            }
          }
        }
      } catch (err) {
        // Ignore les messages malformés
      }
    });

    this.ws.on('error', (err) => {
      logger.error('WebSocket erreur', { error: err.message });
    });

    this.ws.on('close', () => {
      logger.warn('⚠️ WebSocket déconnecté — reconnexion dans 5s...');
      if (this.reconnectAttempts < this.MAX_RECONNECT) {
        this.reconnectAttempts++;
        setTimeout(() => this.subscribeToTicker(pairs, onPrice), 5000);
      } else {
        logger.error('❌ WebSocket : nombre max de reconnexions atteint');
      }
    });
  }

  closeWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // =============================================
  // Test de Connexion
  // =============================================
  async testConnection(): Promise<boolean> {
    try {
      // Test avec l'endpoint public (prix BTC) d'abord, puis les comptes
      const { data } = await this.http.get('/api/v3/brokerage/products/BTC-USD');
      logger.info(`✅ Connexion Coinbase OK — BTC-USD: $${parseFloat(data.price).toLocaleString()}`);
      return true;
    } catch (err: any) {
      logger.error('❌ Échec connexion Coinbase', { error: err.response?.data || err.message });
      return false;
    }
  }
}
