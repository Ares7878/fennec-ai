-- ============================================
-- 🦊 FENNEC AI — Schéma Base de Données SQLite
-- ============================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =============================================
-- Table : Trades
-- Historique de tous les ordres exécutés
-- =============================================
CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT UNIQUE,            -- ID de l'ordre Coinbase
  pair            TEXT NOT NULL,          -- Ex: BTC-USD
  side            TEXT NOT NULL,          -- 'buy' ou 'sell'
  mode            TEXT NOT NULL,          -- 'paper' ou 'live'
  strategy        TEXT NOT NULL,          -- Stratégie utilisée
  entry_price     REAL,                   -- Prix d'entrée
  exit_price      REAL,                   -- Prix de sortie
  quantity        REAL NOT NULL,          -- Quantité tradée
  amount_usd      REAL NOT NULL,          -- Valeur en USD
  pnl             REAL DEFAULT 0,         -- Profit/Perte
  pnl_percent     REAL DEFAULT 0,         -- P&L en %
  fees            REAL DEFAULT 0,         -- Frais payés
  status          TEXT DEFAULT 'open',    -- 'open', 'closed', 'cancelled'
  stop_loss       REAL,                   -- Prix stop-loss
  take_profit     REAL,                   -- Prix take-profit
  close_reason    TEXT,                   -- Raison de fermeture
  signal_data     TEXT,                   -- JSON des signaux
  opened_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at       DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Table : Portfolio Snapshots
-- Photo du portefeuille à intervalles réguliers
-- =============================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  total_usd       REAL NOT NULL,          -- Valeur totale en USD
  cash_usd        REAL NOT NULL,          -- Cash disponible
  invested_usd    REAL NOT NULL,          -- Montant investi
  open_trades     INTEGER DEFAULT 0,      -- Positions ouvertes
  daily_pnl       REAL DEFAULT 0,         -- P&L du jour
  total_pnl       REAL DEFAULT 0,         -- P&L total cumulé
  snapshot_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Table : Market Data (Cache)
-- Cache des données de marché récentes
-- =============================================
CREATE TABLE IF NOT EXISTS market_data (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pair            TEXT NOT NULL,
  interval        TEXT NOT NULL,
  open            REAL NOT NULL,
  high            REAL NOT NULL,
  low             REAL NOT NULL,
  close           REAL NOT NULL,
  volume          REAL NOT NULL,
  timestamp       DATETIME NOT NULL,
  UNIQUE(pair, interval, timestamp)
);

-- =============================================
-- Table : Signals
-- Historique des signaux générés
-- =============================================
CREATE TABLE IF NOT EXISTS signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pair            TEXT NOT NULL,
  strategy        TEXT NOT NULL,
  signal          TEXT NOT NULL,          -- 'buy', 'sell', 'hold'
  strength        REAL DEFAULT 0,         -- Force du signal (0-1)
  price           REAL NOT NULL,
  indicators      TEXT,                   -- JSON des valeurs d'indicateurs
  acted_on        INTEGER DEFAULT 0,      -- 1 si un trade a été créé
  generated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Table : Configuration
-- Paramètres persistants du bot
-- =============================================
CREATE TABLE IF NOT EXISTS bot_config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Table : Notifications
-- Historique des notifications envoyées
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,          -- 'trade_open', 'trade_close', 'alert', 'report', 'error'
  message         TEXT NOT NULL,
  metadata        TEXT,                   -- JSON
  sent            INTEGER DEFAULT 0,
  sent_at         DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Index pour les performances
-- =============================================
CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at);
CREATE INDEX IF NOT EXISTS idx_market_data_pair_interval ON market_data(pair, interval);
CREATE INDEX IF NOT EXISTS idx_signals_pair ON signals(pair);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshot_at ON portfolio_snapshots(snapshot_at);

-- =============================================
-- Données initiales
-- =============================================
INSERT OR IGNORE INTO bot_config (key, value) VALUES
  ('paper_balance_usd', '10000'),
  ('bot_started_at', datetime('now')),
  ('version', '1.0.0');
