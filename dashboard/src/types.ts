// =============================================
// 🦊 Fennec AI — Types globaux du Dashboard
// =============================================

export interface BotStatus {
  running: boolean;
  paused: boolean;
  mode: 'paper' | 'live';
  strategy: string;
  uptime: number;
  drawdown: number;
  dailyLoss: number;
  limits?: any;
}

export interface CryptoPrice {
  pair: string;
  price: number;
  change24h: number;
  volume24h: number;
  lastUpdated: Date;
}

export interface Trade {
  id: number;
  pair: string;
  side: 'buy' | 'sell';
  mode: 'paper' | 'live';
  strategy: string;
  entry_price: number;
  exit_price?: number;
  quantity: number;
  amount_usd: number;
  fees: number;
  pnl: number;
  pnl_percent: number;
  stop_loss: number;
  take_profit: number;
  status: 'open' | 'closed';
  close_reason?: string;
  created_at: string;
  closed_at?: string;
}

export interface Portfolio {
  total_usd: number;
  cash_usd: number;
  invested_usd: number;
  open_trades: number;
  daily_pnl: number;
  total_pnl: number;
  initial_balance: number;
}

export interface PortfolioSnapshot {
  timestamp: string;
  total_usd: number;
  daily_pnl: number;
}

export interface Signal {
  id: number;
  pair: string;
  strategy: string;
  signal: 'buy' | 'sell' | 'hold';
  strength: number;
  price: number;
  reason?: string;
  acted_on: boolean;  // true si ce signal a déclenché un trade
  created_at: string;
}

export interface Stats {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_pnl: number;
  total_fees: number;
  best_trade: number;
  worst_trade: number;
  win_rate: number;
  avg_pnl: number;
}

export type NavPage = 'dashboard' | 'trades' | 'signals' | 'settings';

export const STOCK_META: Record<string, { emoji: string; color: string; name: string }> = {
  'SPY': { emoji: '🇺🇸', color: '#16a34a', name: 'S&P 500 ETF' },
  'QQQ': { emoji: '📈', color: '#0284c7', name: 'Nasdaq ETF' },
  'AAPL': { emoji: '🍏', color: '#94a3b8', name: 'Apple Inc.' },
  'MSFT': { emoji: '🪟', color: '#0ea5e9', name: 'Microsoft' },
  'NVDA': { emoji: '🖥️', color: '#84cc16', name: 'Nvidia Corp.' },
  'TSLA': { emoji: '🚗', color: '#dc2626', name: 'Tesla Inc.' },
};
