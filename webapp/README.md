# MyselfMonArt — Moteur de rendu des mockups

Petit serveur Node qui tourne **sur le PC** (là où sont les fichiers PSD et Chrome) et génère les
mockups en pilotant **Photopea** en headless. L'interface utilisateur (la page « Publisher ») est
servie par le backend MyselfMonArt ; elle appelle ce moteur pour produire les rendus.

```
  Téléphone / PC  ──►  backend.myselfmonart.com/publisher   (UI + collections + publication)
                                   │
                                   ▼  (via tunnel Cloudflare)
                          Ce moteur sur le PC               (rendu des mockups via Photopea)
                          + dossier des PSD + Chrome
```

## Prérequis
- Node.js 18+
- Google Chrome installé
- Le dossier des mockups, organisé ainsi :
  `mockups/<type>/<catégorie>/<sous-catégorie>/<orientation>.psd`
  (type = `toile` | `poster` | `tapisserie` ; orientation = `portrait` | `landscape` | `square`)

## Installation
```bash
cd webapp
npm install
cp .env.example .env   # puis ajuster MOCKUPS_PATH si besoin
```

## Démarrage
```bash
npm start
```
Le moteur écoute sur `http://localhost:4000` (configurable via `PORT`).
Au démarrage il lance Chrome + Photopea (headless) et le garde ouvert.

## Exposition pour le mobile (tunnel Cloudflare)
Pour que la page servie par le backend puisse atteindre ce moteur depuis l'extérieur :
```bash
cloudflared tunnel --url http://localhost:4000
```
Cela fournit une URL publique (ex. `https://xxxx.trycloudflare.com`). Renseigne cette URL
dans la variable d'environnement **`RENDER_ENGINE_URL`** du backend (voir son `.env`).

## API
- `GET  /api/templates?type=toile` → catégories/mockups disponibles pour ce type.
- `POST /api/render` `{ psd, image (dataURL|url), mockupContext }` → `{ success, url, mockupContext }`.
- `GET  /uploads/...` et `/mockups/...` → fichiers (rendus et aperçus).
- `DELETE /api/upload/:name` → supprime un rendu.

> Note : les collections et la publication Shopify ne passent **pas** par ce moteur ;
> l'UI les appelle directement sur le backend.
