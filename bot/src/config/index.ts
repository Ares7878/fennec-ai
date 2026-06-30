import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`❌ Variable d'environnement manquante : ${key}`);
  return val;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config = {
  // Coinbase
  coinbase: {
    apiKey: required('COINBASE_API_KEY'),
    apiSecret: required('COINBASE_API_SECRET'),
    passphrase: optional('COINBASE_PASSPHRASE', ''),
    baseUrl: 'https://api.coinbase.com',
    wsUrl: 'wss://advanced-trade-ws.coinbase.com',
  },

  // Telegram
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
  },

  // Trading
  trading: {
    mode: optional('TRADING_MODE', 'paper') as 'paper' | 'live',
    pairs: optional('TRADING_PAIRS', 'BTC-USD,ETH-USD,SOL-USD,XRP-USD,DOGE-USD,AVAX-USD')
      .split(',').map(p => p.trim()),
    maxTradeAmountUsd: parseFloat(optional('MAX_TRADE_AMOUNT_USD', '54')),
    maxPositionSize: parseFloat(optional('MAX_POSITION_SIZE', '0.10')),
    defaultStopLoss: parseFloat(optional('DEFAULT_STOP_LOSS', '0.03')),
    defaultTakeProfit: parseFloat(optional('DEFAULT_TAKE_PROFIT', '0.06')),
    maxDrawdown: parseFloat(optional('MAX_DRAWDOWN', '0.15')),
    // Capital initial Paper Trading (500€ ≈ 540 USD)
    paperInitialBalance: parseFloat(optional('PAPER_INITIAL_BALANCE', '540')),
  },

  // Strategy
  strategy: {
    active: optional('ACTIVE_STRATEGY', 'rsi') as 'rsi' | 'macd' | 'ema_cross' | 'bollinger',
    candleInterval: optional('CANDLE_INTERVAL', '15m'),
  },

  // API Server (pour le dashboard web)
  api: {
    port: parseInt(optional('API_PORT', '3001')),
    secretKey: optional('API_SECRET_KEY', 'change_me_in_production'),
  },

  // Database
  database: {
    path: path.resolve(optional('DATABASE_PATH', './data/fennec.db')),
  },

  // Logs
  logs: {
    level: optional('LOG_LEVEL', 'info'),
    dir: path.resolve(optional('LOG_DIR', './logs')),
  },

  // Reports
  reports: {
    dailyTime: optional('DAILY_REPORT_TIME', '20:00'),
  },
};

export type Config = typeof config;
