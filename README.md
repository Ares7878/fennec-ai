# 🦊 Fennec AI — Bot de Trading

Bot de trading automatisé professionnel connecté à Coinbase Advanced Trade avec notifications Telegram.

## 🚀 Installation Rapide

### Prérequis
- Node.js 20 LTS ([nodejs.org](https://nodejs.org))
- Un compte Coinbase avec accès Advanced Trade
- Un bot Telegram (créé via @BotFather)

### 1. Installation des dépendances

```bash
cd bot
npm install
```

### 2. Configuration

```bash
# Copiez le fichier exemple
cp .env.example .env

# Éditez avec vos vraies clés
notepad .env   # Windows
nano .env      # Linux/Mac
```

Remplissez dans `.env` :
- `COINBASE_API_KEY` et `COINBASE_API_SECRET` depuis Advanced.coinbase.com → API
- `TELEGRAM_BOT_TOKEN` depuis @BotFather sur Telegram
- `TELEGRAM_CHAT_ID` depuis @userinfobot sur Telegram
- Laissez `TRADING_MODE=paper` pour commencer en simulation !

### 3. Lancement

```bash
# Mode développement (avec logs en temps réel)
npm run dev

# Mode production (après npm run build)
npm start
```

## 📱 Commandes Telegram

| Commande | Description |
|---|---|
| `/start` | Message de bienvenue |
| `/status` | État du bot et prix actuels |
| `/trades` | 10 derniers trades |
| `/pnl` | Profit & Perte du jour et total |
| `/portfolio` | Vue du portefeuille |
| `/pause` | Mettre le bot en pause |
| `/resume` | Reprendre le trading |

## 🧠 Stratégies Disponibles

| Stratégie | Description |
|---|---|
| `rsi` | RSI avec zones survente/surachat |
| `macd` | Croisements MACD/Signal |
| `ema_cross` | Golden Cross / Death Cross EMA |
| `bollinger` | Rebond sur bandes de Bollinger |

Pour changer de stratégie, modifiez `ACTIVE_STRATEGY` dans `.env`.

## 🛡️ Risk Management

- **Stop-Loss** : 3% par défaut (configurable)
- **Take-Profit** : 6% par défaut (configurable)
- **Max par trade** : 10% du portefeuille
- **Max trades ouverts** : 3 simultanément
- **Arrêt d'urgence** : si drawdown > 15%

## 🖥️ Production sur NUC (PM2)

```bash
# Build TypeScript
npm run build

# Démarrage avec PM2
pm2 start ecosystem.config.js

# Démarrage automatique au boot
pm2 startup
pm2 save

# Logs en temps réel
pm2 logs fennec-ai-bot

# Status
pm2 status
```

## ⚠️ Avertissement

Le trading de crypto-monnaies comporte des risques de perte en capital.
**Commencez TOUJOURS en Paper Trading** avant de passer en mode Live.
N'investissez jamais plus que ce que vous pouvez vous permettre de perdre.
