// =============================================
// 🦊 Fennec AI — API Client (connexion au bot)
// =============================================
import axios from 'axios';
import type { BotStatus, Trade, Portfolio, PortfolioSnapshot, Signal, Stats, CryptoPrice } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 8000,
});

// =============================================
// Bot Status
// =============================================
export async function fetchBotStatus(): Promise<BotStatus> {
  const { data } = await api.get('/api/status');
  return data;
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
export async function fetchPrices(): Promise<CryptoPrice[]> {
  const { data } = await api.get('/api/prices');
  return data;
}

// =============================================
// Portfolio
// =============================================
export async function fetchPortfolio(): Promise<Portfolio> {
  const { data } = await api.get('/api/portfolio');
  return data;
}

export async function fetchPortfolioHistory(): Promise<PortfolioSnapshot[]> {
  const { data } = await api.get('/api/portfolio/history');
  return data;
}

// =============================================
// Trades
// =============================================
export async function fetchTrades(limit = 50): Promise<Trade[]> {
  const { data } = await api.get(`/api/trades?limit=${limit}`);
  return data;
}

export async function fetchOpenTrades(): Promise<Trade[]> {
  const { data } = await api.get('/api/trades/open');
  return data;
}

// =============================================
// Stats
// =============================================
export async function fetchStats(): Promise<Stats> {
  const { data } = await api.get('/api/stats');
  return data;
}

// =============================================
// Signals
// =============================================
export async function fetchSignals(limit = 30): Promise<Signal[]> {
  const { data } = await api.get(`/api/signals?limit=${limit}`);
  return data;
}

// =============================================
// Mock data pour démo offline
// =============================================
export function getMockStatus(): BotStatus {
  return {
    running: true,
    paused: false,
    mode: 'paper',
    strategy: 'rsi',
    uptime: 3600 * 2,
    drawdown: 0.023,
    dailyLoss: 4.5,
  };
}

export function getMockPrices(): CryptoPrice[] {
  return [
    { pair: 'BTC-USD', price: 67234.56, change24h: 2.34, volume24h: 28_450_000_000, lastUpdated: new Date() },
    { pair: 'ETH-USD', price: 3512.78, change24h: -1.12, volume24h: 14_200_000_000, lastUpdated: new Date() },
    { pair: 'SOL-USD', price: 182.45, change24h: 5.67, volume24h: 3_100_000_000, lastUpdated: new Date() },
    { pair: 'XRP-USD', price: 0.5234, change24h: 0.89, volume24h: 1_800_000_000, lastUpdated: new Date() },
    { pair: 'DOGE-USD', price: 0.1234, change24h: -2.45, volume24h: 980_000_000, lastUpdated: new Date() },
    { pair: 'AVAX-USD', price: 38.92, change24h: 3.21, volume24h: 450_000_000, lastUpdated: new Date() },
  ];
}

export function getMockPortfolio(): Portfolio {
  return {
    total_usd: 543.82,
    cash_usd: 389.20,
    invested_usd: 154.62,
    open_trades: 2,
    daily_pnl: 7.34,
    total_pnl: 3.82,
    initial_balance: 540,
  };
}

export function getMockPortfolioHistory(): PortfolioSnapshot[] {
  const now = Date.now();
  const history: PortfolioSnapshot[] = [];
  let value = 540;
  for (let i = 48; i >= 0; i--) {
    value += (Math.random() - 0.44) * 8;
    history.push({
      timestamp: new Date(now - i * 1800_000).toISOString(),
      total_usd: parseFloat(value.toFixed(2)),
      daily_pnl: parseFloat(((Math.random() - 0.4) * 15).toFixed(2)),
    });
  }
  return history;
}

export function getMockTrades(): Trade[] {
  return [
    {
      id: 1, pair: 'BTC-USD', side: 'buy', mode: 'paper', strategy: 'rsi',
      entry_price: 66800, exit_price: 67234, quantity: 0.00075, amount_usd: 50.1, fees: 0.3,
      pnl: 3.26, pnl_percent: 1.45, stop_loss: 64796, take_profit: 70848,
      status: 'closed', close_reason: 'Take Profit', created_at: new Date(Date.now() - 7200_000).toISOString(),
      closed_at: new Date(Date.now() - 3600_000).toISOString(),
    },
    {
      id: 2, pair: 'SOL-USD', side: 'buy', mode: 'paper', strategy: 'rsi',
      entry_price: 178.20, quantity: 0.2810, amount_usd: 50.07, fees: 0.3,
      pnl: 0, pnl_percent: 0, stop_loss: 172.85, take_profit: 188.89,
      status: 'open', created_at: new Date(Date.now() - 1800_000).toISOString(),
    },
    {
      id: 3, pair: 'ETH-USD', side: 'buy', mode: 'paper', strategy: 'macd',
      entry_price: 3550, quantity: 0.01406, amount_usd: 49.91, fees: 0.3,
      pnl: 0, pnl_percent: 0, stop_loss: 3443.5, take_profit: 3763,
      status: 'open', created_at: new Date(Date.now() - 900_000).toISOString(),
    },
    {
      id: 4, pair: 'DOGE-USD', side: 'sell', mode: 'paper', strategy: 'rsi',
      entry_price: 0.128, exit_price: 0.122, quantity: 390, amount_usd: 49.92, fees: 0.3,
      pnl: -2.64, pnl_percent: -2.34, stop_loss: 0, take_profit: 0,
      status: 'closed', close_reason: 'Stop Loss', created_at: new Date(Date.now() - 14400_000).toISOString(),
      closed_at: new Date(Date.now() - 10800_000).toISOString(),
    },
  ];
}

export function getMockStats(): Stats {
  return {
    total_trades: 47, winning_trades: 31, losing_trades: 16,
    total_pnl: 38.45, total_fees: 14.1,
    best_trade: 18.92, worst_trade: -8.34,
    win_rate: 65.96, avg_pnl: 0.82,
  };
}
