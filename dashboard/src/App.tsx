import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type {
  BotStatus, CryptoPrice, Portfolio, Trade, Stats, PortfolioSnapshot, NavPage, Signal
} from './types';
import { CRYPTO_META } from './types';
import {
  getMockStatus, getMockPrices, getMockPortfolio,
  getMockPortfolioHistory, getMockTrades, getMockStats,
  fetchBotStatus, fetchPrices, fetchPortfolio,
  fetchPortfolioHistory, fetchTrades, fetchStats, fetchSignals,
  pauseBot, resumeBot, changeStrategy,
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

// @ts-ignore
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// =============================================
// Composant: Sidebar
// =============================================
function Sidebar({ page, onNav, onAbout, onLogout }: { page: NavPage; onNav: (p: NavPage) => void; onAbout: () => void; onLogout: () => void }) {
  const items: { page: NavPage; icon: string; label: string }[] = [
    { page: 'dashboard', icon: '📊', label: 'Dashboard' },
    { page: 'trades', icon: '💹', label: 'Trades' },
    { page: 'signals', icon: '📡', label: 'Signaux' },
    { page: 'settings', icon: '⚙️', label: 'Paramètres' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/logo.png" alt="Fennec AI" style={{ width: '40px', height: '40px', borderRadius: '8px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.innerText = '🦊'; }} />
      </div>
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
      <div style={{ marginTop: 'auto', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button className="sidebar-btn" onClick={onAbout} title="À propos">
          <span>ℹ️</span>
          <span className="tooltip">À propos</span>
        </button>
        <button className="sidebar-btn" onClick={onLogout} title="Déconnexion" style={{ color: 'var(--color-danger)' }}>
          <span>🚪</span>
          <span className="tooltip">Déconnexion</span>
        </button>
      </div>
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
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-danger)' }}>
              {status.limits?.stopLossPercent ? (status.limits.stopLossPercent * 100).toFixed(0) : '3'}%
            </div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface-3)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Take-Profit</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-success)' }}>
              {status.limits?.takeProfitPercent ? (status.limits.takeProfitPercent * 100).toFixed(0) : '6'}%
            </div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface-3)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Max Trades (Jour)</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
              {status.limits?.maxDailyTrades || 6}
            </div>
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
    { id: 'consensus', name: '🧠 Consensus', desc: '4-en-1 (Recommandé)' },
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
// Page: Signaux — Données réelles depuis la DB
// =============================================
function SignalsPage({ signals }: { signals: Signal[] }) {
  // Si pas de signaux réels, afficher un placeholder
  if (signals.length === 0) {
    return (
      <div className="card animate-in">
        <div className="card-header">
          <span className="card-title">📡 Signaux Consensus</span>
        </div>
        <div className="empty-state">
          <div className="icon">📡</div>
          <p>En attente des premiers signaux...</p>
          <p style={{ fontSize: 11, opacity: 0.6 }}>Le bot analyse les marchés toutes les 15 minutes</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card animate-in">
      <div className="card-header">
        <span className="card-title">📡 Signaux Consensus (4-en-1)</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{signals.length} signaux</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {signals.map(s => {
          const meta = CRYPTO_META[s.pair] || { emoji: '🪙', color: '#888' };
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', background: 'var(--color-surface-3)', borderRadius: 10,
              borderLeft: `3px solid ${
                s.signal === 'buy' ? 'var(--color-success)'
                : s.signal === 'sell' ? 'var(--color-danger)'
                : 'var(--color-text-dim)'
              }`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>{meta.emoji}</span>
                <div>
                  <div style={{ fontWeight: 700 }}>{s.pair.split('-')[0]}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {s.strategy.toUpperCase()} • ${s.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Barre de force du signal */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Force: {(s.strength * 100).toFixed(0)}%</span>
                  <div style={{ width: 60, height: 4, background: 'var(--color-surface-2)', borderRadius: 2 }}>
                    <div style={{
                      width: `${s.strength * 100}%`, height: '100%',
                      background: s.signal === 'buy' ? 'var(--color-success)' : s.signal === 'sell' ? 'var(--color-danger)' : 'var(--color-text-dim)',
                      borderRadius: 2,
                    }} />
                  </div>
                </div>
                <span className={`badge ${
                  s.signal === 'buy' ? 'badge-buy'
                  : s.signal === 'sell' ? 'badge-sell'
                  : 'badge-closed'
                }`} style={{ fontSize: 12, padding: '5px 12px' }}>
                  {s.acted_on ? '✅ ' : ''}{s.signal.toUpperCase()}
                </span>
              </div>
            </div>
          );
        })}
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
              ['Stop-Loss', '1%'],
              ['Take-Profit', '2%'],
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
          <h3 style={{ color: 'var(--color-text)', marginBottom: 8, fontSize: 15 }}>🚀 Architecture du Bot</h3>
          <div style={{ background: 'var(--color-surface-3)', borderRadius: 10, padding: 16, fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 2 }}>
            <div style={{ color: 'var(--color-text-muted)' }}># Hébergement Dashboard (Interface)</div>
            <div style={{ color: 'var(--color-accent)' }}>O2Switch - https://fennec.eldzayer.com</div>
            <div style={{ color: 'var(--color-text-muted)', marginTop: 8 }}># Serveur Bot de Trading (Logique & API)</div>
            <div style={{ color: 'var(--color-accent)' }}>Railway - Node.js (Express)</div>
            <div style={{ color: 'var(--color-text-muted)', marginTop: 8 }}># Connecteurs</div>
            <div style={{ color: 'var(--color-accent)' }}>Coinbase Advanced Trade API (CDP JWT)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================
// App Principale — Connexion réelle au bot Railway
// =============================================
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(localStorage.getItem('fennec_auth') === 'true');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showAbout, setShowAbout] = useState(false);

  const [page, setPage] = useState<NavPage>('dashboard');
  const [status, setStatus] = useState<BotStatus>(getMockStatus());
  const [prices, setPrices] = useState<CryptoPrice[]>(getMockPrices());
  const [portfolio, setPortfolio] = useState<Portfolio>(getMockPortfolio());
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(getMockPortfolioHistory());
  const [trades, setTrades] = useState<Trade[]>(getMockTrades());
  const [stats, setStats] = useState<Stats>(getMockStats());
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedPair, setSelectedPair] = useState('BTC-USD');
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [isOnline, setIsOnline] = useState<boolean | null>(null); // null = connecting
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // =============================================
  // Chargement des données réelles depuis l'API
  // =============================================
  const loadData = useCallback(async () => {
    try {
      const [botStatus, botPrices, botPortfolio, botHistory, botTrades, botStats, botSignals] = await Promise.all([
        fetchBotStatus(),
        fetchPrices(),
        fetchPortfolio(),
        fetchPortfolioHistory(),
        fetchTrades(50),
        fetchStats(),
        fetchSignals(40),
      ]);

      if (botStatus) { setStatus(botStatus); setIsOnline(true); }
      else { setIsOnline(false); }

      if (botPrices && botPrices.length > 0) setPrices(botPrices);
      if (botPortfolio) setPortfolio(botPortfolio);
      if (botHistory && botHistory.length > 0) setPortfolioHistory(botHistory);
      if (botTrades) setTrades(botTrades);
      if (botStats) setStats(botStats);
      if (botSignals) setSignals(botSignals);

      setLastUpdate(new Date());
    } catch {
      setIsOnline(false);
    }
  }, []);

  // Premier chargement + auto-refresh toutes les 30s
  useEffect(() => {
    if (!isLoggedIn) return;
    loadData();
    refreshRef.current = setInterval(loadData, 30_000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [loadData, isLoggedIn]);

  const handlePause = useCallback(async () => {
    try {
      await pauseBot();
      setStatus(prev => ({ ...prev, paused: true }));
    } catch {
      setStatus(prev => ({ ...prev, paused: true })); // fallback local
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await resumeBot();
      setStatus(prev => ({ ...prev, paused: false }));
    } catch {
      setStatus(prev => ({ ...prev, paused: false }));
    }
  }, []);

  const handleStrategyChange = useCallback(async (strategy: string) => {
    try {
      await changeStrategy(strategy);
    } catch { /* ignore */ }
    setStatus(prev => ({ ...prev, strategy }));
  }, []);

  const pageTitle: Record<NavPage, { title: string; sub: string }> = {
    dashboard: { title: '🦊 Fennec AI', sub: 'Dashboard de Trading' },
    trades: { title: '💹 Trades', sub: 'Historique et positions' },
    signals: { title: '📡 Signaux', sub: 'Analyse en temps réel' },
    settings: { title: '⚙️ Paramètres', sub: 'Configuration du bot' },
  };

  const { title, sub } = pageTitle[page];

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginUser === 'fennec' && loginPass === '@Fennec_2026@') {
      setIsLoggedIn(true);
      localStorage.setItem('fennec_auth', 'true');
      setLoginError('');
    } else {
      setLoginError('Identifiants incorrects');
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <form className="login-form glass-panel" onSubmit={handleLogin}>
          <div className="login-logo">
            <img src="/logo.png" alt="Fennec AI" style={{ width: '48px', height: '48px', borderRadius: '12px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.innerText = '🦊'; }} />
          </div>
          <h2>FENNEC AI</h2>
          <p>Connexion au Dashboard</p>
          <input 
            type="text" 
            placeholder="Nom d'utilisateur" 
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
          />
          <input 
            type="password" 
            placeholder="Mot de passe" 
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
          />
          {loginError && <div className="login-error">{loginError}</div>}
          <button type="submit" className="login-btn">Se connecter</button>
        </form>
      </div>
    );
  }

  const handleLogout = useCallback(() => {
    setIsLoggedIn(false);
    localStorage.removeItem('fennec_auth');
  }, []);

  return (
    <div className="app">
      <Sidebar page={page} onNav={setPage} onAbout={() => setShowAbout(true)} onLogout={handleLogout} />
      <main className="main-content">
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <h1>{title}</h1>
            <p>{sub}</p>
          </div>
          <div className="header-right">
            {/* Indicateur de connexion au bot */}
            <span style={{
              fontSize: 11,
              color: isOnline === null ? 'var(--color-text-muted)'
                   : isOnline ? 'var(--color-success)'
                   : 'var(--color-danger)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: 8 }}>●</span>
              {isOnline === null ? 'Connexion...' : isOnline ? `Bot en ligne` : '⚠️ Bot hors ligne'}
            </span>
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
        {page === 'signals' && <SignalsPage signals={signals} />}
        {page === 'settings' && <SettingsPage />}
      </main>

      {/* Modale À Propos */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
          <div className="modal-logo">
            <img src="/logo.png" alt="Fennec AI" style={{ width: '64px', height: '64px', borderRadius: '12px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.innerText = '🦊'; }} />
          </div>
          <h2>FENNEC AI</h2>
            <h3>Bot de trading</h3>
            <div className="modal-info">
              <p>2026 - V1.0</p>
              <p className="developer">Développé par<br/><strong>ARIOUL AMELAL</strong></p>
            </div>
            <button className="modal-close-btn" onClick={() => setShowAbout(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
