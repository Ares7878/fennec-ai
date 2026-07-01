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

export const CRYPTO_META: Record<string, { emoji: string; color: string; name: string }> = {
  'BTC-USD': { emoji: '₿', color: '#f97316', name: 'Bitcoin' },
  'ETH-USD': { emoji: 'Ξ', color: '#6366f1', name: 'Ethereum' },
  'SOL-USD': { emoji: '◎', color: '#a855f7', name: 'Solana' },
  'XRP-USD': { emoji: '✕', color: '#06b6d4', name: 'XRP' },
  'DOGE-USD': { emoji: 'Ð', color: '#eab308', name: 'Dogecoin' },
  'AVAX-USD': { emoji: '🔺', color: '#ef4444', name: 'Avalanche' },
};
