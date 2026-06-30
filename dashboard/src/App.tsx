import React, { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type {
  BotStatus, CryptoPrice, Portfolio, Trade, Stats, PortfolioSnapshot, NavPage
} from './types';
import { CRYPTO_META } from './types';
import {
  getMockStatus, getMockPrices, getMockPortfolio,
  getMockPortfolioHistory, getMockTrades, getMockStats,
} from './api';

// =============================================
// Utils
// =============================================
function formatUSD(v: number, decimals = 2) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(v);
}

function formatPrice(price: number) {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// =============================================
// Composant: Sidebar
// =============================================
function Sidebar({ page, onNav }: { page: NavPage; onNav: (p: NavPage) => void }) {
  const items: { page: NavPage; icon: string; label: string }[] = [
    { page: 'dashboard', icon: '📊', label: 'Dashboard' },
    { page: 'trades', icon: '💹', label: 'Trades' },
    { page: 'signals', icon: '📡', label: 'Signaux' },
    { page: 'settings', icon: '⚙️', label: 'Paramètres' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">🦊</div>
      <nav className="sidebar-nav">
        {items.map(item => (
          <button
            key={item.page}
            id={`nav-${item.page}`}
            className={`sidebar-btn ${page === item.page ? 'active' : ''}`}
            onClick={() => onNav(item.page)}
            title={item.label}
          >
            <span>{item.icon}</span>
            <span className="tooltip">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

// =============================================
// Composant: CryptoCard
// =============================================
function CryptoCard({ cp, selected, onClick }: {
  cp: CryptoPrice; selected: boolean; onClick: () => void;
}) {
  const meta = CRYPTO_META[cp.pair] || { emoji: '🪙', color: '#888', name: cp.pair };
  const isUp = cp.change24h >= 0;

  return (
    <div
      id={`crypto-card-${cp.pair.replace('-', '_')}`}
      className={`crypto-card ${selected ? 'active' : ''}`}
      onClick={onClick}
      style={{ '--accent': meta.color } as React.CSSProperties}
    >
      <div className="crypto-card-top">
        <span className="crypto-symbol">{cp.pair.split('-')[0]}</span>
        <span className="crypto-emoji" style={{ fontSize: 18 }}>{meta.emoji}</span>
      </div>
      <div className="crypto-price mono">{formatPrice(cp.price)}</div>
      <div className={`crypto-change ${isUp ? 'up' : 'down'}`}>
        {isUp ? '▲' : '▼'} {Math.abs(cp.change24h).toFixed(2)}%
      </div>
    </div>
  );
}

// =============================================
// Composant: StatCard
// =============================================
function StatCard({ icon, title, value, sub, changeVal, changeLabel, iconBg }: {
  icon: string; title: string; value: string; sub?: string;
  changeVal?: number; changeLabel?: string; iconBg?: string;
}) {
  const isPositive = (changeVal ?? 0) >= 0;

  return (
    <div className="card animate-in">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div className="card-icon" style={{ background: iconBg || 'var(--color-surface-3)' }}>
          {icon}
        </div>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">
        {changeVal !== undefined && (
          <span className={`stat-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '▲' : '▼'} {Math.abs(changeVal).toFixed(2)}%
          </span>
        )}
        {sub && <span>{sub}</span>}
        {changeLabel && <span>{changeLabel}</span>}
      </div>
    </div>
  );
}

// =============================================
// Composant: Portfolio Chart
// =============================================
function PortfolioChart({ data, initialBalance }: {
  data: PortfolioSnapshot[]; initialBalance: number;
}) {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    const pnl = val - initialBalance;
    return (
      <div style={{
        background: 'var(--color-surface-3)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: '10px 14px', fontSize: 13,
      }}>
        <div style={{ color: 'var(--color-text-muted)', marginBottom: 4, fontSize: 11 }}>
          {new Date(label).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={{ color: 'var(--color-text)', fontWeight: 700 }}>{formatUSD(val)}</div>
        <div style={{ color: pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontSize: 12 }}>
          {pnl >= 0 ? '+' : ''}{formatUSD(pnl)}
        </div>
      </div>
    );
  };

  const minVal = Math.min(...data.map(d => d.total_usd));
  const maxVal = Math.max(...data.map(d => d.total_usd));
  const isProfit = data.length > 0 && data[data.length - 1].total_usd >= initialBalance;

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isProfit ? '#10b981' : '#ef4444'} stopOpacity={0.2} />
              <stop offset="95%" stopColor={isProfit ? '#10b981' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            axisLine={false} tickLine={false} interval={11}
          />
          <YAxis
            domain={[minVal * 0.998, maxVal * 1.002]}
            tickFormatter={(v) => `$${v.toFixed(0)}`}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            axisLine={false} tickLine={false} width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone" dataKey="total_usd"
            stroke={isProfit ? '#10b981' : '#ef4444'} strokeWidth={2}
            fill="url(#portfolioGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// =============================================
// Composant: Trades Table
// =============================================
function TradesTable({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">📋</div>
        <p>Aucun trade pour le moment</p>
        <p style={{ fontSize: 11, opacity: 0.6 }}>Le bot est en train d'analyser les marchés...</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="trades-table">
        <thead>
          <tr>
            <th>Paire</th>
            <th>Côté</th>
            <th>Stratégie</th>
            <th>Prix Entrée</th>
            <th>Prix Sortie</th>
            <th>Montant</th>
            <th>P&L</th>
            <th>Statut</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} id={`trade-row-${t.id}`}>
              <td>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{CRYPTO_META[t.pair]?.emoji || '🪙'}</span>
                  <span style={{ fontWeight: 600 }}>{t.pair.split('-')[0]}</span>
                </span>
              </td>
              <td>
                <span className={`badge ${t.side === 'buy' ? 'badge-buy' : 'badge-sell'}`}>
                  {t.side === 'buy' ? '⬆ BUY' : '⬇ SELL'}
                </span>
              </td>
              <td style={{ color: 'var(--color-text-muted)', textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>
                {t.strategy}
              </td>
              <td className="mono">${t.entry_price.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
              <td className="mono">
                {t.exit_price
                  ? `$${t.exit_price.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
                  : <span style={{ color: 'var(--color-text-dim)' }}>—</span>
                }
              </td>
              <td className="mono">{formatUSD(t.amount_usd)}</td>
              <td>
                {t.status === 'open' ? (
                  <span style={{ color: 'var(--color-info)' }}>En cours...</span>
                ) : (
                  <span
                    style={{
                      color: t.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                      fontWeight: 600,
                    }}
                    className="mono"
                  >
                    {t.pnl >= 0 ? '+' : ''}{formatUSD(t.pnl)}
                    <span style={{ fontSize: 11, opacity: 0.7 }}> ({t.pnl_percent >= 0 ? '+' : ''}{t.pnl_percent.toFixed(2)}%)</span>
                  </span>
                )}
              </td>
              <td>
                <span className={`badge ${t.status === 'open' ? 'badge-open' : 'badge-closed'}`}>
                  {t.status === 'open' ? '● Ouvert' : '✓ Fermé'}
                </span>
              </td>
              <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                {formatDate(t.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================
// Composant: Risk Monitor
// =============================================
function RiskMonitor({ status }: { status: BotStatus }) {
  const drawdownPct = status.drawdown * 100;
  const maxDrawdown = 15;
  const drawdownFill = Math.min((drawdownPct / maxDrawdown) * 100, 100);
  const fillClass = drawdownFill < 40 ? 'safe' : drawdownFill < 70 ? 'warning' : 'danger';

  return (
    <div className="card animate-in animate-in-delay-2">
      <div className="card-header">
        <span className="card-title">🛡️ Risk Monitor</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Drawdown</span>
            <span className="mono" style={{ fontSize: 13, color: drawdownFill > 70 ? 'var(--color-danger)' : 'var(--color-text)' }}>
              {drawdownPct.toFixed(2)}% / {maxDrawdown}%
            </span>
          </div>
          <div className="progress-bar">
            <div className={`progress-fill ${fillClass}`} style={{ width: `${drawdownFill}%` }} />
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Perte journalière</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--color-danger)' }}>
              -${status.dailyLoss.toFixed(2)}
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill safe" style={{ width: `${Math.min((status.dailyLoss / 50) * 100, 100)}%` }} />
          </div>
        </div>
        <div className="divider" />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: 'var(--color-surface-3)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Stop-Loss</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-danger)' }}>3%</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface-3)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Take-Profit</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-success)' }}>6%</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface-3)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Max Trades</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>3</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================
// Composant: Bot Controls
// =============================================
function BotControls({ status, strategy, onPause, onResume, onStrategyChange }: {
  status: BotStatus; strategy: string;
  onPause: () => void; onResume: () => void; onStrategyChange: (s: string) => void;
}) {
  const strategies = [
    { id: 'rsi', name: 'RSI', desc: 'Survente / Surachat' },
    { id: 'macd', name: 'MACD', desc: 'Croisements Signal' },
    { id: 'ema_cross', name: 'EMA Cross', desc: 'Golden / Death Cross' },
    { id: 'bollinger', name: 'Bollinger', desc: 'Rebond sur Bandes' },
  ];

  return (
    <div className="card animate-in animate-in-delay-1">
      <div className="card-header">
        <span className="card-title">⚙️ Contrôles Bot</span>
        <div className="status-indicator">
          <div className={`status-dot ${status.running && !status.paused ? 'active' : status.paused ? 'paused' : 'stopped'}`} />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {status.running && !status.paused ? 'Actif' : status.paused ? 'En pause' : 'Arrêté'}
          </span>
        </div>
      </div>

      <div className="controls-row" style={{ marginBottom: 16 }}>
        {!status.paused ? (
          <button id="btn-pause" className="btn btn-danger" onClick={onPause}>⏸ Pause</button>
        ) : (
          <button id="btn-resume" className="btn btn-success" onClick={onResume}>▶ Reprendre</button>
        )}
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          ⏱ Uptime: <span className="mono" style={{ color: 'var(--color-text)' }}>{formatUptime(status.uptime)}</span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Stratégie Active
      </div>
      <div className="strategy-grid">
        {strategies.map(s => (
          <button
            key={s.id}
            id={`strategy-${s.id}`}
            className={`strategy-btn ${strategy === s.id ? 'active' : ''}`}
            onClick={() => onStrategyChange(s.id)}
          >
            <div className="strategy-name">{s.name}</div>
            <div className="strategy-desc">{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================
// Page: Dashboard Principal
// =============================================
function DashboardPage({
  status, prices, portfolio, portfolioHistory, trades, stats, selectedPair, onSelectPair,
  onPause, onResume, onStrategyChange,
}: {
  status: BotStatus; prices: CryptoPrice[]; portfolio: Portfolio;
  portfolioHistory: PortfolioSnapshot[]; trades: Trade[]; stats: Stats;
  selectedPair: string; onSelectPair: (p: string) => void;
  onPause: () => void; onResume: () => void; onStrategyChange: (s: string) => void;
}) {
  const pnlPercent = portfolio.initial_balance > 0
    ? ((portfolio.total_usd - portfolio.initial_balance) / portfolio.initial_balance) * 100
    : 0;
  const isPnlPositive = portfolio.total_pnl >= 0;

  return (
    <>
      {/* Crypto Prices Row */}
      <div className="crypto-grid animate-in">
        {prices.map(cp => (
          <CryptoCard
            key={cp.pair}
            cp={cp}
            selected={selectedPair === cp.pair}
            onClick={() => onSelectPair(cp.pair)}
          />
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid-4">
        <StatCard
          icon="💼"
          title="Portefeuille Total"
          value={formatUSD(portfolio.total_usd)}
          changeVal={pnlPercent}
          changeLabel={`vs ${formatUSD(portfolio.initial_balance)} initial`}
          iconBg="rgba(249, 115, 22, 0.1)"
        />
        <StatCard
          icon="📈"
          title="P&L Total"
          value={`${isPnlPositive ? '+' : ''}${formatUSD(portfolio.total_pnl)}`}
          sub={`${isPnlPositive ? '+' : ''}${pnlPercent.toFixed(2)}%`}
          iconBg={isPnlPositive ? 'var(--color-success-bg)' : 'var(--color-danger-bg)'}
        />
        <StatCard
          icon="📅"
          title="P&L Aujourd'hui"
          value={`${portfolio.daily_pnl >= 0 ? '+' : ''}${formatUSD(portfolio.daily_pnl)}`}
          sub="Depuis minuit"
          iconBg="rgba(6, 182, 212, 0.1)"
        />
        <StatCard
          icon="🎯"
          title="Win Rate"
          value={`${stats.win_rate.toFixed(1)}%`}
          sub={`${stats.winning_trades}W / ${stats.losing_trades}L sur ${stats.total_trades} trades`}
          iconBg="rgba(16, 185, 129, 0.1)"
        />
      </div>

      {/* Chart + Controls */}
      <div className="grid-2-3">
        {/* Chart */}
        <div className="card animate-in">
          <div className="card-header">
            <span className="card-title">📈 Évolution du Portefeuille</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>48 dernières heures</span>
          </div>
          <PortfolioChart data={portfolioHistory} initialBalance={portfolio.initial_balance} />
          <div style={{ display: 'flex', gap: 20, marginTop: 12, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              💵 Cash: <strong style={{ color: 'var(--color-text)' }}>{formatUSD(portfolio.cash_usd)}</strong>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              📦 Investi: <strong style={{ color: 'var(--color-text)' }}>{formatUSD(portfolio.invested_usd)}</strong>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              🔵 Trades ouverts: <strong style={{ color: 'var(--color-info)' }}>{portfolio.open_trades}</strong>
            </span>
          </div>
        </div>

        {/* Controls + Risk */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BotControls
            status={status}
            strategy={status.strategy}
            onPause={onPause}
            onResume={onResume}
            onStrategyChange={onStrategyChange}
          />
          <RiskMonitor status={status} />
        </div>
      </div>

      {/* Recent Trades */}
      <div className="card animate-in animate-in-delay-3">
        <div className="card-header">
          <span className="card-title">💹 Derniers Trades</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="mode-badge paper">
              <span className="dot" />
              PAPER TRADING
            </span>
          </div>
        </div>
        <TradesTable trades={trades.slice(0, 5)} />
      </div>
    </>
  );
}

// =============================================
// Page: Trades Complète
// =============================================
function TradesPage({ trades }: { trades: Trade[] }) {
  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');
  const totalPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);

  return (
    <>
      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="card animate-in">
          <div className="card-title" style={{ marginBottom: 8 }}>Positions ouvertes</div>
          <div className="stat-value" style={{ color: 'var(--color-info)' }}>{openTrades.length}</div>
        </div>
        <div className="card animate-in animate-in-delay-1">
          <div className="card-title" style={{ marginBottom: 8 }}>Trades fermés</div>
          <div className="stat-value">{closedTrades.length}</div>
        </div>
        <div className="card animate-in animate-in-delay-2">
          <div className="card-title" style={{ marginBottom: 8 }}>P&L Total Réalisé</div>
          <div className="stat-value" style={{ color: totalPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {totalPnl >= 0 ? '+' : ''}{formatUSD(totalPnl)}
          </div>
        </div>
      </div>
      <div className="card animate-in">
        <div className="card-header">
          <span className="card-title">📋 Historique Complet des Trades</span>
        </div>
        <TradesTable trades={trades} />
      </div>
    </>
  );
}

// =============================================
// Page: Signaux
// =============================================
function SignalsPage({ prices }: { prices: CryptoPrice[] }) {
  const signals = prices.map(p => ({
    pair: p.pair,
    change: p.change24h,
    signal: Math.abs(p.change24h) > 3 ? (p.change24h > 0 ? 'BUY' : 'SELL') : 'HOLD',
  }));

  return (
    <div className="card animate-in">
      <div className="card-header">
        <span className="card-title">📡 Signaux Temps Réel</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {signals.map(s => (
          <div key={s.pair} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: 'var(--color-surface-3)', borderRadius: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{CRYPTO_META[s.pair]?.emoji || '🪙'}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{s.pair.split('-')[0]}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {s.change > 0 ? '+' : ''}{s.change.toFixed(2)}% sur 24h
                </div>
              </div>
            </div>
            <span className={`badge ${s.signal === 'BUY' ? 'badge-buy' : s.signal === 'SELL' ? 'badge-sell' : 'badge-closed'}`}
              style={{ fontSize: 12, padding: '5px 12px' }}>
              {s.signal}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================
// Page: Paramètres
// =============================================
function SettingsPage() {
  return (
    <div className="card animate-in">
      <div className="card-header">
        <span className="card-title">⚙️ Paramètres</span>
      </div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.8 }}>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ color: 'var(--color-text)', marginBottom: 8, fontSize: 15 }}>🔒 Clés API</h3>
          <p>Les clés API sont configurées dans le fichier <code style={{ background: 'var(--color-surface-3)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>bot/.env</code></p>
          <p style={{ marginTop: 4 }}>Ne partagez jamais ce fichier !</p>
        </div>
        <div className="divider" />
        <div style={{ marginBottom: 20, marginTop: 20 }}>
          <h3 style={{ color: 'var(--color-text)', marginBottom: 8, fontSize: 15 }}>📊 Configuration Actuelle</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['Mode', '📄 Paper Trading'],
              ['Cryptos', 'BTC, ETH, SOL, XRP, DOGE, AVAX'],
              ['Capital simulé', '$540 (≈ 500€)'],
              ['Stop-Loss', '3%'],
              ['Take-Profit', '6%'],
              ['Max Drawdown', '15%'],
              ['Intervalle', '15 minutes'],
              ['Max trades', '3 simultanés'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--color-surface-3)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="divider" />
        <div style={{ marginTop: 20 }}>
          <h3 style={{ color: 'var(--color-text)', marginBottom: 8, fontSize: 15 }}>🚀 Déploiement O2Switch</h3>
          <div style={{ background: 'var(--color-surface-3)', borderRadius: 10, padding: 16, fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 2 }}>
            <div style={{ color: 'var(--color-text-muted)' }}># Connexion SSH</div>
            <div style={{ color: 'var(--color-accent)' }}>ssh user@votre-domaine.com</div>
            <div style={{ color: 'var(--color-text-muted)', marginTop: 8 }}># Build et démarrage</div>
            <div style={{ color: 'var(--color-accent)' }}>cd fennec-ai/bot && npm install</div>
            <div style={{ color: 'var(--color-accent)' }}>npm run build</div>
            <div style={{ color: 'var(--color-accent)' }}>pm2 start ecosystem.config.js</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================
// App Principale
// =============================================
export default function App() {
  const [page, setPage] = useState<NavPage>('dashboard');
  const [status, setStatus] = useState<BotStatus>(getMockStatus());
  const [prices, setPrices] = useState<CryptoPrice[]>(getMockPrices());
  const [portfolio, setPortfolio] = useState<Portfolio>(getMockPortfolio());
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(getMockPortfolioHistory());
  const [trades, setTrades] = useState<Trade[]>(getMockTrades());
  const [stats, setStats] = useState<Stats>(getMockStats());
  const [selectedPair, setSelectedPair] = useState('BTC-USD');
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Simulation de mise à jour des prix en temps réel (demo mode)
  useEffect(() => {
    const interval = setInterval(() => {
      setPrices(prev => prev.map(p => ({
        ...p,
        price: p.price * (1 + (Math.random() - 0.5) * 0.002),
        lastUpdated: new Date(),
      })));
      setLastUpdate(new Date());
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handlePause = useCallback(() => {
    setStatus(prev => ({ ...prev, paused: true }));
  }, []);

  const handleResume = useCallback(() => {
    setStatus(prev => ({ ...prev, paused: false }));
  }, []);

  const handleStrategyChange = useCallback((strategy: string) => {
    setStatus(prev => ({ ...prev, strategy }));
  }, []);

  const pageTitle: Record<NavPage, { title: string; sub: string }> = {
    dashboard: { title: '🦊 Fennec AI', sub: 'Dashboard de Trading' },
    trades: { title: '💹 Trades', sub: 'Historique et positions' },
    signals: { title: '📡 Signaux', sub: 'Analyse en temps réel' },
    settings: { title: '⚙️ Paramètres', sub: 'Configuration du bot' },
  };

  const { title, sub } = pageTitle[page];

  return (
    <div className="app">
      <Sidebar page={page} onNav={setPage} />
      <main className="main-content">
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <h1>{title}</h1>
            <p>{sub}</p>
          </div>
          <div className="header-right">
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Mis à jour: {lastUpdate.toLocaleTimeString('fr-FR')}
            </span>
            <span className={`mode-badge ${status.mode}`}>
              <span className="dot" />
              {status.mode === 'paper' ? 'PAPER TRADING' : 'LIVE'}
            </span>
          </div>
        </header>

        {/* Pages */}
        {page === 'dashboard' && (
          <DashboardPage
            status={status}
            prices={prices}
            portfolio={portfolio}
            portfolioHistory={portfolioHistory}
            trades={trades}
            stats={stats}
            selectedPair={selectedPair}
            onSelectPair={setSelectedPair}
            onPause={handlePause}
            onResume={handleResume}
            onStrategyChange={handleStrategyChange}
          />
        )}
        {page === 'trades' && <TradesPage trades={trades} />}
        {page === 'signals' && <SignalsPage prices={prices} />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
