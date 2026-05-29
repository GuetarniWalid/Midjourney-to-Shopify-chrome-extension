#!/usr/bin/env bash
#
# Désinstalle le LaunchAgent du serveur mockup. Utile si tu veux désactiver
# le démarrage automatique ou repartir de zéro.
#
# Usage : ./uninstall-launchagent.sh

set -euo pipefail

PLIST_LABEL="com.myselfmonart.mockup-server"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

if launchctl list | grep -q "$PLIST_LABEL"; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  echo "↺ LaunchAgent déchargé."
fi

if [[ -f "$PLIST_PATH" ]]; then
  rm "$PLIST_PATH"
  echo "🗑  Plist supprimé : $PLIST_PATH"
else
  echo "ℹ  Aucun plist à supprimer."
fi

echo "✅ Désinstallation terminée."
