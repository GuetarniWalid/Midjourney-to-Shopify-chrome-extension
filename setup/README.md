# Setup automatique pour utilisatrice non-technique

Ce dossier contient tout ce qu'il faut pour transformer le workflow d'installation
en **un seul double-clic quotidien**.

## Ce que ça fait

| Avant (4 étapes) | Après |
|---|---|
| 1. Ouvrir UXP Developer Tools, *Add Plugin*, sélectionner le manifest | Plugin pré-enregistré, apparaît à l'ouverture |
| 2. Cliquer *Load* dans UXP Developer Tools | ⚠ Toujours nécessaire (1 clic) |
| 3. Ouvrir Photoshop Beta puis cliquer *Connect to Server* | Auto-connect du WebSocket |
| 4. `cd dist/mockup-server && npm start` | LaunchAgent démarre le serveur au login |

## Installation initiale (à faire UNE fois)

```bash
cd /Users/hayate/Documents/Midjourney-to-Shopify-chrome-extension
bash setup/setup-all.sh
```

Ce script idempotent :

1. Build le projet si nécessaire
2. Installe le LaunchAgent (`~/Library/LaunchAgents/com.myselfmonart.mockup-server.plist`)
3. Pré-enregistre le plugin dans UDT (`plugins_workspace.json`)
4. Crée un alias `MyselfMonArt - Démarrer.command` sur le Bureau

## Workflow quotidien

1. **Double-clic** sur `MyselfMonArt - Démarrer` (Bureau)
2. UXP Developer Tools s'ouvre → la ligne *Mockup Categories Server* est déjà là → **clic ••• → Load**
3. Photoshop Beta s'ouvre, le panneau *Mockup Categories* apparaît dans `Plugins > Mockup Categories`
4. Le panneau **se connecte tout seul** au serveur (plus besoin de cliquer *Connect*)
5. Utiliser l'extension Chrome normalement

## Désinstallation

```bash
bash setup/uninstall-launchagent.sh
```

Puis supprimer manuellement l'alias du Bureau.

## Logs

- **Serveur mockup** : `~/Library/Logs/MyselfMonArt/mockup-server.{out,err}.log`
- **UDT** : `~/Library/Application Support/Adobe/Adobe UXP Developer Tool/Logs/`

## Pourquoi pas une automation 100% sans clic ?

Photoshop **Beta** ne supporte pas l'install permanente des plugins UXP via
`.ccx` sans signature Adobe. La seule façon de faire apparaître un plugin de
dev dans Photoshop Beta est de passer par UDT — d'où le clic *Load* résiduel.

Si à terme on bascule sur Photoshop stable + plugin signé `.ccx`, ce dernier
clic disparaît aussi.
