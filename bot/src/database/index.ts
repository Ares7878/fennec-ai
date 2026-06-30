import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SCHEMA_SQL } from './schema';

// =============================================
// Couche d'abstraction sql.js avec persistence
// sql.js = SQLite compilé en WebAssembly → zéro dépendance native
// =============================================

let db: SqlJsDatabase;
let dbPath: string;

// Sauvegarde automatique sur disque après chaque écriture
function persistDb(): void {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err: any) {
    logger.error('Erreur sauvegarde DB', { error: err.message });
  }
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Base de données non initialisée. Appelez initDatabase() d\'abord.');
  }
  return db;
}

export async function initDatabase(): Promise<SqlJsDatabase> {
  dbPath = config.database.path;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info(`📁 Dossier créé : ${dbDir}`);
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    logger.info(`📂 Base de données chargée : ${dbPath}`);
  } else {
    db = new SQL.Database();
    logger.info(`🆕 Nouvelle base de données : ${dbPath}`);
  }

  // Chargement et exécution du schéma
  db.run(SCHEMA_SQL);
  persistDb();

  // Sauvegarde périodique toutes les 30 secondes
  setInterval(persistDb, 30_000);

  logger.info('✅ Base de données initialisée avec succès');
  return db;
}

// =============================================
// Helper — exécute un run avec persistence
// =============================================
function dbRun(sql: string, params?: Record<string, any> | any[]): void {
  getDatabase().run(sql, params as any);
  persistDb();
}

// =============================================
// Helper — récupère des lignes
// =============================================
function dbAll<T>(sql: string, params?: any[]): T[] {
  const stmt = getDatabase().prepare(sql);
  if (params) stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return rows;
}

function dbGet<T>(sql: string, params?: any[]): T | undefined {
  const rows = dbAll<T>(sql, params);
  return rows[0];
}

function dbLastId(): number {
  const result = dbGet<{ id: number }>('SELECT last_insert_rowid() as id');
  return result?.id || 0;
}

// =============================================
// Requêtes — Trades
// =============================================
export const tradeQueries = {
  insert: (trade: Omit<TradeRecord, 'id' | 'created_at' | 'opened_at'>) => {
    dbRun(`
      INSERT INTO trades (order_id, pair, side, mode, strategy, entry_price, quantity, amount_usd, stop_loss, take_profit, signal_data, fees, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      trade.order_id, trade.pair, trade.side, trade.mode, trade.strategy,
      trade.entry_price, trade.quantity, trade.amount_usd,
      trade.stop_loss ?? null, trade.take_profit ?? null,
      trade.signal_data ?? null, trade.fees ?? 0, trade.status ?? 'open'
    ]);
    return dbLastId();
  },

  close: (id: number, data: { exit_price: number; pnl: number; pnl_percent: number; fees: number; close_reason: string }) => {
    dbRun(`
      UPDATE trades SET
        exit_price = ?, pnl = ?, pnl_percent = ?, fees = ?,
        status = 'closed', close_reason = ?,
        closed_at = datetime('now')
      WHERE id = ?
    `, [data.exit_price, data.pnl, data.pnl_percent, data.fees, data.close_reason, id]);
  },

  getOpen: (pair?: string): TradeRecord[] => {
    if (pair) {
      return dbAll<TradeRecord>(`SELECT * FROM trades WHERE status = 'open' AND pair = ?`, [pair]);
    }
    return dbAll<TradeRecord>(`SELECT * FROM trades WHERE status = 'open'`);
  },

  getAll: (limit = 100): TradeRecord[] => {
    return dbAll<TradeRecord>(`SELECT * FROM trades ORDER BY created_at DESC LIMIT ?`, [limit]);
  },

  getDailyStats: (): DailyStats => {
    return dbGet<DailyStats>(`
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(pnl) as total_pnl,
        AVG(pnl_percent) as avg_pnl_percent,
        SUM(fees) as total_fees
      FROM trades
      WHERE date(closed_at) = date('now') AND status = 'closed'
    `) || { total_trades: 0, winning_trades: 0, total_pnl: 0, avg_pnl_percent: 0, total_fees: 0 };
  },

  getStats: (): OverallStats => {
    return dbGet<OverallStats>(`
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(pnl) as total_pnl,
        MAX(pnl) as best_trade,
        MIN(pnl) as worst_trade,
        AVG(pnl_percent) as avg_pnl_percent,
        SUM(fees) as total_fees
      FROM trades WHERE status = 'closed'
    `) || { total_trades: 0, winning_trades: 0, total_pnl: 0, best_trade: 0, worst_trade: 0, avg_pnl_percent: 0, total_fees: 0 };
  },
};

// =============================================
// Requêtes — Market Data
// =============================================
export const marketQueries = {
  insertCandle: (candle: CandleRecord) => {
    dbRun(`
      INSERT OR REPLACE INTO market_data (pair, interval, open, high, low, close, volume, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [candle.pair, candle.interval, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.timestamp]);
  },

  getCandles: (pair: string, interval: string, limit = 200): CandleRecord[] => {
    return dbAll<CandleRecord>(`
      SELECT * FROM market_data WHERE pair = ? AND interval = ?
      ORDER BY timestamp DESC LIMIT ?
    `, [pair, interval, limit]);
  },
};

// =============================================
// Requêtes — Signaux
// =============================================
export const signalQueries = {
  insert: (signal: Omit<SignalRecord, 'id' | 'generated_at'>) => {
    dbRun(`
      INSERT INTO signals (pair, strategy, signal, strength, price, indicators, acted_on)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [signal.pair, signal.strategy, signal.signal, signal.strength, signal.price, signal.indicators ?? null, signal.acted_on ?? 0]);
    return dbLastId();
  },

  getRecent: (pair: string, limit = 50): SignalRecord[] => {
    return dbAll<SignalRecord>(`
      SELECT * FROM signals WHERE pair = ? ORDER BY generated_at DESC LIMIT ?
    `, [pair, limit]);
  },
};

// =============================================
// Requêtes — Portfolio Snapshots
// =============================================
export const portfolioQueries = {
  insert: (snapshot: Omit<PortfolioSnapshot, 'id' | 'snapshot_at'>) => {
    dbRun(`
      INSERT INTO portfolio_snapshots (total_usd, cash_usd, invested_usd, open_trades, daily_pnl, total_pnl)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [snapshot.total_usd, snapshot.cash_usd, snapshot.invested_usd, snapshot.open_trades, snapshot.daily_pnl, snapshot.total_pnl]);
  },

  getLast: (): PortfolioSnapshot | undefined => {
    return dbGet<PortfolioSnapshot>(`SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 1`);
  },

  getHistory: (days = 30): PortfolioSnapshot[] => {
    return dbAll<PortfolioSnapshot>(`
      SELECT * FROM portfolio_snapshots
      WHERE snapshot_at >= datetime('now', '-${days} days')
      ORDER BY snapshot_at ASC
    `);
  },
};

// =============================================
// Requêtes — Config
// =============================================
export const configQueries = {
  get: (key: string): string | undefined => {
    const row = dbGet<{ value: string }>(`SELECT value FROM bot_config WHERE key = ?`, [key]);
    return row?.value;
  },

  set: (key: string, value: string) => {
    dbRun(`
      INSERT OR REPLACE INTO bot_config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `, [key, value]);
  },
};

// =============================================
// Types
// =============================================
export interface TradeRecord {
  id: number;
  order_id: string;
  pair: string;
  side: 'buy' | 'sell';
  mode: 'paper' | 'live';
  strategy: string;
  entry_price: number;
  exit_price?: number;
  quantity: number;
  amount_usd: number;
  pnl: number;
  pnl_percent: number;
  fees: number;
  status: 'open' | 'closed' | 'cancelled';
  stop_loss?: number;
  take_profit?: number;
  close_reason?: string;
  signal_data?: string;
  opened_at: string;
  closed_at?: string;
  created_at: string;
}

export interface CandleRecord {
  pair: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface SignalRecord {
  id: number;
  pair: string;
  strategy: string;
  signal: 'buy' | 'sell' | 'hold';
  strength: number;
  price: number;
  indicators?: string;
  acted_on: number;
  generated_at: string;
}

export interface PortfolioSnapshot {
  id: number;
  total_usd: number;
  cash_usd: number;
  invested_usd: number;
  open_trades: number;
  daily_pnl: number;
  total_pnl: number;
  snapshot_at: string;
}

export interface DailyStats {
  total_trades: number;
  winning_trades: number;
  total_pnl: number;
  avg_pnl_percent: number;
  total_fees: number;
}

export interface OverallStats {
  total_trades: number;
  winning_trades: number;
  total_pnl: number;
  best_trade: number;
  worst_trade: number;
  avg_pnl_percent: number;
  total_fees: number;
}
