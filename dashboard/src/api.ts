// =============================================
// 🦊 Fennec AI — API Client (connexion au bot Railway)
// =============================================
import axios, { AxiosError } from 'axios';
import type { BotStatus, Trade, Portfolio, PortfolioSnapshot, Signal, Stats, CryptoPrice } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const API_KEY  = import.meta.env.VITE_API_KEY  || '';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 8000,
  headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
});

// Helper : retourne null si erreur réseau (mode offline)
async function safeGet<T>(url: string): Promise<T | null> {
  try {
    const { data } = await api.get<T>(url);
    return data;
  } catch (err) {
    const e = err as AxiosError;
    if (e.code === 'ERR_NETWORK' || e.code === 'ECONNREFUSED') return null;
    throw err;
  }
}

// =============================================
// Bot Status
// =============================================
export async function fetchBotStatus(): Promise<BotStatus | null> {
  const data = await safeGet<any>('/api/status');
  if (!data) return null;
  return {
    running: data.running ?? true,
    paused: data.paused ?? false,
    mode: data.mode ?? 'paper',
    strategy: data.strategy ?? 'consensus',
    uptime: data.uptime ?? 0,
    drawdown: data.drawdown ?? 0,
    dailyLoss: data.dailyLoss ?? 0,
    limits: data.limits,
  };
}

export async function pauseBot(): Promise<void> {
  await api.post('/api/bot/pause');
}

export async function resumeBot(): Promise<void> {
  await api.post('/api/bot/resume');
}

export async function changeStrategy(strategy: string): Promise<void> {
  await api.post('/api/bot/strategy', { strategy });
}

// =============================================
// Prix Cryptos
// =============================================
export async function fetchPrices(): Promise<CryptoPrice[] | null> {
  const data = await safeGet<any[]>('/api/prices');
  if (!data) return null;
  return data.map(p => ({
    pair: p.pair,
    price: p.price,
    change24h: p.change24h ?? 0,
    volume24h: p.volume24h ?? 0,
    lastUpdated: new Date(p.lastUpdated),
  }));
}

// =============================================
// Portfolio
// =============================================
export async function fetchPortfolio(): Promise<Portfolio | null> {
  return safeGet<Portfolio>('/api/portfolio');
}

export async function fetchPortfolioHistory(): Promise<PortfolioSnapshot[] | null> {
  return safeGet<PortfolioSnapshot[]>('/api/portfolio/history');
}

// =============================================
// Trades
// =============================================
export async function fetchTrades(limit = 50): Promise<Trade[] | null> {
  return safeGet<Trade[]>(`/api/trades?limit=${limit}`);
}

export async function fetchOpenTrades(): Promise<Trade[] | null> {
  return safeGet<Trade[]>('/api/trades/open');
}

// =============================================
// Stats
// =============================================
export async function fetchStats(): Promise<Stats | null> {
  return safeGet<Stats>('/api/stats');
}

// =============================================
// Signals
// =============================================
export async function fetchSignals(limit = 30): Promise<Signal[] | null> {
  return safeGet<Signal[]>(`/api/signals?limit=${limit}`);
}

// =============================================
// Données de fallback (mode offline / premier démarrage)
// =============================================
export function getMockStatus(): BotStatus {
  return {
    running: true,
    paused: false,
    mode: 'paper',
    strategy: 'consensus',
    uptime: 0,
    drawdown: 0,
    dailyLoss: 0,
    limits: { stopLossPercent: 0.03, takeProfitPercent: 0.06, maxDailyTrades: 6 },
  };
}

export function getMockPrices(): CryptoPrice[] {
  return [
    { pair: 'BTC-USD', price: 0, change24h: 0, volume24h: 0, lastUpdated: new Date() },
    { pair: 'ETH-USD', price: 0, change24h: 0, volume24h: 0, lastUpdated: new Date() },
    { pair: 'SOL-USD', price: 0, change24h: 0, volume24h: 0, lastUpdated: new Date() },
    { pair: 'XRP-USD', price: 0, change24h: 0, volume24h: 0, lastUpdated: new Date() },
    { pair: 'DOGE-USD', price: 0, change24h: 0, volume24h: 0, lastUpdated: new Date() },
    { pair: 'AVAX-USD', price: 0, change24h: 0, volume24h: 0, lastUpdated: new Date() },
  ];
}

export function getMockPortfolio(): Portfolio {
  return {
    total_usd: 540,
    cash_usd: 540,
    invested_usd: 0,
    open_trades: 0,
    daily_pnl: 0,
    total_pnl: 0,
    initial_balance: 540,
  };
}

export function getMockPortfolioHistory(): PortfolioSnapshot[] {
  return [{ timestamp: new Date().toISOString(), total_usd: 540, daily_pnl: 0 }];
}

export function getMockTrades(): Trade[] { return []; }

export function getMockStats(): Stats {
  return {
    total_trades: 0, winning_trades: 0, losing_trades: 0,
    total_pnl: 0, total_fees: 0,
    best_trade: 0, worst_trade: 0,
    win_rate: 0, avg_pnl: 0,
  };
}
