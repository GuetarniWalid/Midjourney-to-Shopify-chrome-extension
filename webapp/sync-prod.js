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
for (const f of ['app.js', 'style.css']) {
  fs.copyFileSync(path.join(FRONT, f), path.join(MIRROR, f))
  console.log(`copié  ${f} -> ${path.join(MIRROR, f)}`)
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
  "     - mode       : '' = create (publication classique), 'reimage' = refaire les images d'un produit -->",
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

fs.writeFileSync(EDGE, html)
console.log(`généré ${EDGE}`)

// --- 3. vérification de parité ---
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12)
for (const f of ['app.js', 'style.css']) {
  const a = sha(path.join(FRONT, f))
  const b = sha(path.join(MIRROR, f))
  if (a !== b) throw new Error(`désynchro ${f} : ${a} != ${b}`)
  console.log(`parité ${f} OK (${a})`)
}
console.log('Synchro PROD terminée.')
