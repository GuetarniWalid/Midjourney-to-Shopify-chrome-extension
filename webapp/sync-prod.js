// Synchronise le front Publisher vers le miroir PROD (repo MyselfMonArt_Backend) :
//   - copie public/app.js et public/style.css tels quels (byte-identiques)
//   - régénère resources/views/pages/publisher.edge à partir de public/index.html
//     (source de vérité), en ne substituant que les chemins d'assets et le bloc
//     de config injecté par le backend (renderBase / mode).
// Usage : node sync-prod.js [chemin-du-repo-backend]
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const FRONT = path.join(__dirname, 'public')
const BACKEND = process.argv[2] || path.join(__dirname, '..', '..', 'MyselfMonArt_Backend')
const MIRROR = path.join(BACKEND, 'public', 'publisher')
const EDGE = path.join(BACKEND, 'resources', 'views', 'pages', 'publisher.edge')

// --- 1. copies byte-identiques ---
for (const f of ['app.js', 'style.css', 'bulk-posters.js', 'personalized.js']) {
  fs.copyFileSync(path.join(FRONT, f), path.join(MIRROR, f))
  console.log(`copié  ${f} -> ${path.join(MIRROR, f)}`)
}

// --- 1b. presets du mode « poster personnalisé » (copies depuis le repo thème, servis statiquement) ---
const PRESETS_SRC = path.join(FRONT, 'presets')
const PRESETS_DST = path.join(MIRROR, 'presets')
fs.mkdirSync(PRESETS_DST, { recursive: true })
for (const f of fs.readdirSync(PRESETS_SRC).filter((f) => f.endsWith('.json'))) {
  fs.copyFileSync(path.join(PRESETS_SRC, f), path.join(PRESETS_DST, f))
  console.log(`copié  presets/${f}`)
}

// --- 2. publisher.edge régénéré depuis index.html ---
// Cache-busting : les assets prod partent avec Cache-Control: max-age=14400 (4 h) -> sans
// version dans l'URL, les téléphones gardent l'ANCIEN app.js après un déploiement (bouton
// invisible, etc.). On suffixe ?v=<hash du contenu> : nouvelle version = URL neuve = rechargée.
const sha10 = (f) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(FRONT, f))).digest('hex').slice(0, 10)
const vJs = sha10('app.js')
const vCss = sha10('style.css')

let html = fs.readFileSync(path.join(FRONT, 'index.html'), 'utf8')

const cssLocal = '<link rel="stylesheet" href="style.css">'
const cssProd = `<link rel="stylesheet" href="/publisher/style.css?v=${vCss}">`
if (!html.includes(cssLocal)) throw new Error('ancre stylesheet introuvable dans index.html')
html = html.replace(cssLocal, cssProd)

// bloc de config local (commentaire + script + src) -> bloc injecté par le backend
const configAnchor = /<!-- Config : en local[\s\S]*?<script src="app\.js"><\/script>/
if (!configAnchor.test(html)) throw new Error('bloc de config local introuvable dans index.html')
const edgeConfig = [
  '<!-- Config injectée par le backend :',
  "     - renderBase : URL du moteur de rendu (PC, via tunnel Cloudflare) — variable d'env RENDER_ENGINE_URL",
  '     - apiBase    : vide => même origine (ce backend sert collections + publish)',
  "     - mode       : '' = create (publication classique), 'reimage' = refaire les images d'un produit,",
  "                    'personalized' = créer un poster personnalisé (builder studio.config/recipe) -->",
  '<script>',
  '  window.PUBLISHER_CONFIG = {',
  '    renderBase: {{{ JSON.stringify(renderBase || \'\') }}},',
  "    apiBase: '',",
  '    mode: {{{ JSON.stringify(mode || \'\') }}}',
  '  };',
  '</script>',
  `<script src="/publisher/app.js?v=${vJs}"></script>`,
].join('\n')
html = html.replace(configAnchor, edgeConfig)

// personalized.js : hors du bloc de config (il suit app.js) -> substitution dédiée, versionnée
const vPers = sha10('personalized.js')
const persLocal = '<script src="personalized.js"></script>'
if (!html.includes(persLocal)) throw new Error('balise personalized.js introuvable dans index.html')
html = html.replace(persLocal, `<script src="/publisher/personalized.js?v=${vPers}"></script>`)

fs.writeFileSync(EDGE, html)
console.log(`généré ${EDGE}`)

// --- 2b. bulk-posters.edge régénéré depuis bulk-posters.html (page autonome « posters en masse ») ---
// Même principe que publisher.edge : on ne substitue que les chemins d'assets (versionnés) et le
// bloc de config injecté par le backend (renderBase = moteur du PC ; apiBase = même origine).
const vBulk = sha10('bulk-posters.js')
let bp = fs.readFileSync(path.join(FRONT, 'bulk-posters.html'), 'utf8')
const bpCssLocal = '<link rel="stylesheet" href="style.css" />'
if (!bp.includes(bpCssLocal)) throw new Error('ancre stylesheet introuvable dans bulk-posters.html')
bp = bp.replace(bpCssLocal, `<link rel="stylesheet" href="/publisher/style.css?v=${vCss}" />`)
const bpConfigAnchor = /<!-- Config : en local[\s\S]*?<script src="bulk-posters\.js"><\/script>/
if (!bpConfigAnchor.test(bp)) throw new Error('bloc de config local introuvable dans bulk-posters.html')
const bpEdgeConfig = [
  '<!-- Config injectée par le backend (renderBase = moteur de rendu du PC ; apiBase = même origine) -->',
  '<script>',
  '  window.PUBLISHER_CONFIG = {',
  "    renderBase: {{{ JSON.stringify(renderBase || '') }}},",
  "    apiBase: ''",
  '  };',
  '</script>',
  `<script src="/publisher/bulk-posters.js?v=${vBulk}"></script>`,
].join('\n')
bp = bp.replace(bpConfigAnchor, bpEdgeConfig)
const BULK_EDGE = path.join(BACKEND, 'resources', 'views', 'pages', 'bulk-posters.edge')
fs.writeFileSync(BULK_EDGE, bp)
console.log(`généré ${BULK_EDGE}`)

// --- 3. vérification de parité ---
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12)
for (const f of ['app.js', 'style.css', 'bulk-posters.js', 'personalized.js']) {
  const a = sha(path.join(FRONT, f))
  const b = sha(path.join(MIRROR, f))
  if (a !== b) throw new Error(`désynchro ${f} : ${a} != ${b}`)
  console.log(`parité ${f} OK (${a})`)
}
console.log('Synchro PROD terminée.')
