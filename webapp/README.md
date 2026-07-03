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

## Modes de la page Publisher

La même page (`public/index.html` + `app.js` + `style.css`) tourne en plusieurs modes, injectés
par le backend via `window.PUBLISHER_CONFIG.mode` (ou `?mode=…` en local sur le moteur) :

- **create** (défaut) — publication classique d'une œuvre.
- **reimage** (`/publisher/reimage`) — refaire les images d'un produit existant.
- **personalized** (`/publisher/personalized`) — **créer un poster personnalisé** (studio piloté
  par metafields). Logique dédiée dans `public/personalized.js` (chargé après `app.js`, même scope) ;
  `app.js` ne porte que les points de branchement (`IS_PERSONALIZED`).

### Poster personnalisé (mode `personalized`)

Industrialise la création d'un produit « studio » (ex. poster famille en dessin au trait) piloté
par 3 metafields Shopify — sans déploiement de code par produit :

- `studio.config` (json) — étapes du parcours client (photo, textes, format), libellés i18n 5 langues,
  juge photo (`photoPolicy`). **Builder** = carte 3 : preset → formulaires guidés → validation LIVE.
- `studio.recipe` (json) — recette de génération IA (prompt, modèle, substitutions). **Builder** = carte 4.
- `studio.references` (list.file_reference) — image(s) de style pour Gemini (uploadée à la publication).

Points clés :
- **Validateur « sûr à 100 % »** : `public/lib/validate-studio-config.js` est une **COPIE** du
  validateur du moteur studio (repo thème `dev-harness/validate-studio-config.mjs`) — corps de
  `validateConfig` **identique** ; le jumeau serveur est `MyselfMonArt_Backend/app/Services/StudioConfig/
  validateStudioConfig.ts`. **Resynchroniser les deux à chaque évolution du moteur studio.**
- **Presets** (`public/presets/*.json`) : copies des configs/recette du repo thème.
- **Publication** : payload publish étendu d'un bloc `personalized` ; le backend crée le produit en
  **BROUILLON** avec sa grille de variantes dédiée (12) + ses metafields (cf. `PersonalizedSetup.ts`).
- **Double copie du front** : `public/*` (dev, servi par ce moteur) + miroir PROD dans
  `MyselfMonArt_Backend/public/publisher/`. Toujours porter les modifs aux deux via
  **`node sync-prod.js`** (copie app.js/style.css/personalized.js + `lib/` + `presets/`, régénère
  `publisher.edge` avec cache-busting) ; c'est le push backend qui déploie.
