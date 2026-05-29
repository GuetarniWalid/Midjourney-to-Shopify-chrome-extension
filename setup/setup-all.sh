#!/usr/bin/env bash
#
# Setup tout-en-un (à exécuter UNE seule fois sur le Mac de l'utilisatrice).
# Idempotent : on peut le rejouer sans casser quoi que ce soit.
#
#   1. Vérifie que le projet est buildé (npm run build:dev déjà lancé)
#   2. Installe le LaunchAgent (serveur mockup démarre au login)
#   3. Pré-enregistre le plugin dans Adobe UXP Developer Tools
#   4. Crée un alias "MyselfMonArt - Démarrer" sur le Bureau
#
# Usage (depuis n'importe quel dossier) :
#   bash /chemin/vers/Midjourney-to-Shopify-chrome-extension/setup/setup-all.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
LAUNCHER="$SCRIPT_DIR/MyselfMonArt - Démarrer.command"
DESKTOP="$HOME/Desktop"
UDT_PREFS_DIR="$HOME/Library/Application Support/Adobe/Adobe UXP Developer Tool"
UDT_WORKSPACE="$UDT_PREFS_DIR/plugins_workspace.json"
PLUGIN_MANIFEST="$DIST_DIR/photoshop-uxp-plugin/manifest.json"

echo "═══════════════════════════════════════════════════════"
echo "  Configuration MyselfMonArt — installation initiale"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 1. Vérifier le build ─────────────────────────────────────────────────────
echo "[1/4] Vérification du build…"
if [[ ! -f "$PLUGIN_MANIFEST" ]] || [[ ! -d "$DIST_DIR/mockup-server/node_modules" ]]; then
  echo "   ⚠ dist/ incomplet. Build en cours…"
  (
    cd "$PROJECT_DIR/mockup-server" && [[ -d node_modules ]] || npm install --silent
  )
  (cd "$PROJECT_DIR" && npm run build:dev)
fi
echo "   ✅ build OK"
echo ""

# ── 2. Installer le LaunchAgent ──────────────────────────────────────────────
echo "[2/4] Installation du LaunchAgent (serveur auto au login)…"
bash "$SCRIPT_DIR/install-launchagent.sh"
echo ""

# ── 3. Pré-enregistrer le plugin dans UDT ────────────────────────────────────
echo "[3/4] Enregistrement du plugin dans Adobe UXP Developer Tools…"
mkdir -p "$UDT_PREFS_DIR"

# On écrit (ou ré-écrit) plugins_workspace.json pour qu'il pointe vers le manifest
# du plugin qu'on vient de builder. Comme ça, à l'ouverture de UDT, le plugin
# apparaît dans la liste sans avoir à cliquer "Add Plugin".
/usr/bin/python3 - "$UDT_WORKSPACE" "$PLUGIN_MANIFEST" <<'PY'
import json, os, sys
workspace_path, manifest_path = sys.argv[1], sys.argv[2]
data = {"version": 1, "plugins": []}
if os.path.exists(workspace_path):
    try:
        with open(workspace_path) as f:
            data = json.load(f)
    except Exception:
        pass
plugins = data.get("plugins", [])
# On garde tout sauf une éventuelle ancienne entrée pour le même manifest
plugins = [p for p in plugins if p.get("manifestPath") != manifest_path]
plugins.append({
    "manifestPath": manifest_path,
    "pluginOptions": {"breakOnStart": False},
    "hostParam": "PS",
})
data["plugins"] = plugins
data.setdefault("version", 1)
with open(workspace_path, "w") as f:
    json.dump(data, f)
print(f"   ✅ {manifest_path} enregistré dans UDT")
PY
echo ""

# ── 4. Alias sur le Bureau ───────────────────────────────────────────────────
echo "[4/4] Création du raccourci sur le Bureau…"
DESKTOP_LINK="$DESKTOP/MyselfMonArt - Démarrer.command"
# Copie réelle (pas un symlink) : iCloud Drive synchronise le Bureau et casse
# les symlinks Unix au fil des syncs entre appareils.
if [[ -L "$DESKTOP_LINK" || -f "$DESKTOP_LINK" ]]; then
  # Si déjà protégé par le flag uchg, le retirer avant de remplacer
  chflags nouchg "$DESKTOP_LINK" 2>/dev/null || true
  rm -f "$DESKTOP_LINK"
fi
cp "$LAUNCHER" "$DESKTOP_LINK"
chmod +x "$DESKTOP_LINK"
# Flag immuable : empêche Finder/iCloud/rm de supprimer le raccourci.
# Pour retirer la protection plus tard : chflags nouchg "$DESKTOP_LINK"
chflags uchg "$DESKTOP_LINK"
echo "   ✅ Raccourci créé et verrouillé : $DESKTOP_LINK"
echo ""

echo "═══════════════════════════════════════════════════════"
echo "  ✅ Installation terminée"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Workflow quotidien pour ta femme :"
echo "  1. Ouvrir le Bureau"
echo "  2. Double-cliquer 'MyselfMonArt - Démarrer'"
echo "  3. Dans UXP Developer Tools : cliquer ••• → Load sur la ligne du plugin"
echo "     (à faire UNE SEULE fois par session Photoshop)"
echo "  4. Travailler dans Chrome — le panneau Photoshop est déjà connecté"
echo ""
echo "Logs serveur : ~/Library/Logs/MyselfMonArt/"
echo "Pour désinstaller : bash $SCRIPT_DIR/uninstall-launchagent.sh"
