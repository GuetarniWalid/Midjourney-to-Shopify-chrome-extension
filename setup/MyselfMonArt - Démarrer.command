#!/usr/bin/env bash
#
# Lanceur tout-en-un MyselfMonArt.
# Double-clique ce fichier (ou son alias sur le Bureau) pour démarrer
# l'environnement complet en une seule action :
#   1. Vérifie que le serveur de mockups tourne (le LaunchAgent l'a démarré au login)
#   2. Ouvre Adobe UXP Developer Tools (le plugin est déjà enregistré dans sa liste)
#   3. Ouvre Adobe Photoshop (Beta)
#   4. Affiche un rappel : "Clique 'Load' dans UXP Developer Tools si ce n'est pas déjà fait"
#
# Le plugin se connecte ensuite automatiquement au serveur — plus besoin
# de cliquer sur le bouton "Connect to Server" dans le panneau Photoshop.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_HEALTH_URL="http://127.0.0.1:3001/health"
UDT_APP="/Applications/Adobe UXP Developer Tools/Adobe UXP Developer Tools.app"
PS_APP="/Applications/Adobe Photoshop (Beta)/Adobe Photoshop (Beta).app"

notify() {
  # Affiche une notification macOS — visible même si la fenêtre Terminal est cachée
  /usr/bin/osascript -e "display notification \"$1\" with title \"MyselfMonArt\""
}

dialog() {
  /usr/bin/osascript -e "display dialog \"$1\" with title \"MyselfMonArt\" buttons {\"OK\"} default button 1 with icon note giving up after 8" >/dev/null 2>&1
}

echo "🎨 Démarrage de l'environnement MyselfMonArt…"
echo "   Projet : $PROJECT_DIR"

# ── 1. Vérifier le serveur de mockups ────────────────────────────────────────
echo "→ Vérification du serveur de mockups…"
if /usr/bin/curl -sSf --max-time 2 "$SERVER_HEALTH_URL" >/dev/null 2>&1; then
  echo "   ✅ serveur déjà en route"
else
  echo "   ⚠ serveur inaccessible — patiente, le LaunchAgent peut mettre quelques secondes"
  for i in 1 2 3 4 5; do
    sleep 2
    if /usr/bin/curl -sSf --max-time 2 "$SERVER_HEALTH_URL" >/dev/null 2>&1; then
      echo "   ✅ serveur disponible après ${i} tentative(s)"
      break
    fi
  done
  if ! /usr/bin/curl -sSf --max-time 2 "$SERVER_HEALTH_URL" >/dev/null 2>&1; then
    notify "Serveur de mockups injoignable — relance le LaunchAgent."
    dialog "Le serveur de mockups n'a pas répondu sur $SERVER_HEALTH_URL.\\n\\nDemande à Walid de vérifier le LaunchAgent (logs dans ~/Library/Logs/MyselfMonArt/)."
  fi
fi

# ── 2. Ouvrir Adobe UXP Developer Tools ──────────────────────────────────────
echo "→ Ouverture de Adobe UXP Developer Tools…"
if [[ -d "$UDT_APP" ]]; then
  /usr/bin/open -a "$UDT_APP"
else
  notify "Adobe UXP Developer Tools introuvable dans /Applications."
fi

# ── 3. Ouvrir Photoshop Beta ─────────────────────────────────────────────────
echo "→ Ouverture de Adobe Photoshop (Beta)…"
if [[ -d "$PS_APP" ]]; then
  /usr/bin/open -a "$PS_APP"
else
  notify "Adobe Photoshop (Beta) introuvable dans /Applications."
fi

# ── 4. Rappel pour le clic Load ──────────────────────────────────────────────
# UDT a déjà le plugin enregistré dans plugins_workspace.json — il suffit
# de cliquer "Load" une seule fois après l'ouverture pour injecter le panneau
# dans Photoshop. La connexion au serveur se fait ensuite automatiquement.
sleep 2
notify "Clique 'Load' dans UXP Developer Tools, puis utilise le panneau dans Photoshop."

echo ""
echo "✅ Tout est lancé. Dans UXP Developer Tools :"
echo "   • Trouve la ligne 'Mockup Categories Server'"
echo "   • Clique sur le bouton ••• (Actions) → Load"
echo "   • Le panneau apparaît dans Photoshop > Plugins > Mockup Categories"
echo "   • Le panneau se connecte tout seul au serveur, plus rien à faire."
echo ""
