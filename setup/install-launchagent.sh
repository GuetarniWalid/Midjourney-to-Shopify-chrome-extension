#!/usr/bin/env bash
#
# Installe le LaunchAgent qui démarre automatiquement le serveur de mockup
# au login (et le redémarre s'il plante). Une fois exécuté une fois, le
# serveur tourne en permanence en arrière-plan — aucune commande npm à
# lancer manuellement.
#
# Usage : ./install-launchagent.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/dist/mockup-server"
LOG_DIR="$HOME/Library/Logs/MyselfMonArt"
PLIST_LABEL="com.myselfmonart.mockup-server"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
TEMPLATE="$SCRIPT_DIR/com.myselfmonart.mockup-server.plist.template"

# Localise node sans présumer du PATH du shell GUI
NODE_PATH="$(command -v node || true)"
if [[ -z "$NODE_PATH" ]]; then
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_PATH="$candidate"
      break
    fi
  done
fi
if [[ -z "$NODE_PATH" ]]; then
  echo "❌ Node introuvable — installe Node avant de relancer." >&2
  exit 1
fi

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "❌ $SERVER_DIR n'existe pas. Lance 'npm run build:dev' à la racine du projet d'abord." >&2
  exit 1
fi

if [[ ! -f "$SERVER_DIR/server.js" ]]; then
  echo "❌ $SERVER_DIR/server.js introuvable." >&2
  exit 1
fi

if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
  echo "❌ $SERVER_DIR/node_modules manquant. Lance 'npm install' dans mockup-server puis re-build." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$PLIST_PATH")"

# Si déjà chargé, on décharge proprement avant de remplacer le plist
if launchctl list | grep -q "$PLIST_LABEL"; then
  echo "↺ Déchargement de l'ancien LaunchAgent…"
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Génère le plist final à partir du template
sed \
  -e "s|__NODE_PATH__|$NODE_PATH|g" \
  -e "s|__SERVER_DIR__|$SERVER_DIR|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$TEMPLATE" > "$PLIST_PATH"

launchctl load "$PLIST_PATH"

echo "✅ LaunchAgent installé."
echo "   Plist  : $PLIST_PATH"
echo "   Logs   : $LOG_DIR/mockup-server.{out,err}.log"
echo "   Test   : curl -sSf http://localhost:3001/health 2>/dev/null || echo 'pas encore prêt — attends 2 sec'"
echo ""
echo "Le serveur démarrera maintenant automatiquement à chaque connexion."
