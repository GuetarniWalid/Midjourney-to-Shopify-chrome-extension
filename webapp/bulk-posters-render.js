// ===== Posters en masse — RENDU + ORCHESTRATION CÔTÉ SERVEUR (pivot COPIE, sans navigateur) =====
//
// Porte la logique de public/bulk-posters.js (orchestrateur navigateur, désormais abandonné) DANS le
// moteur de rendu PC. L'agent Claude Code (workflow) n'appelle QUE ce serveur ; celui-ci :
//   - rend les mockups des FAVORIS ★ poster PHOTOPEA (zéro insertion IA = zéro Gemini payant) ;
//   - construit les jumeaux passe-partout AU FORMAT CIBLE (sharp, pas le canvas navigateur) ;
//   - appelle le backend (create-one COPIE + status + finalize + delete-draft) avec le jeton de service ;
//   - applique le TOUT-OU-RIEN : 2 tentatives, suppression du brouillon raté, « cap » → brouillon gardé.
//
// Fixes PRÉSERVÉS : passe-partout maté au format cible (3:4 portrait / 4:3 paysage) ; noms de fichiers
// de mockups uniques (géré côté backend composePosterMedia, suffixe d'index en brouillon).

const fsp = require('fs/promises')
const sharp = require('sharp')

const PP_RATIO = 0.08 // bordure passe-partout = 8 % du petit côté (identique au studio)
const POLL_INTERVAL = 4000
const POLL_MAX_MS = 120000 // au-delà : variantes non créées -> cap quotidien probable

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/* ---------- favoris ★ poster PHOTOPEA (mêmes filtres que le studio, AI exclus) ---------- */
async function loadPhotopeaFavorites(readSaved, ratio) {
  const db = await readSaved()
  return (db.photopea || []).filter(
    (t) =>
      (!t.type || t.type === 'poster') &&
      (!(t.orientations && t.orientations[0]) || t.orientations[0] === ratio)
  )
}

/* ---------- rendu d'un PSD favori avec une œuvre (buffer) ---------- */
async function renderPsdBuffer(deps, psdUrl, artworkBuf, mime) {
  const psdAbs = deps.psdDiskPath(psdUrl) // anti-traversal (réutilise le helper de server.js)
  const psdBuffer = await fsp.readFile(psdAbs)
  return await deps.engine.render(psdBuffer, artworkBuf, mime || 'image/jpeg', 0.92)
}

/* ---------- œuvre « mat-ée » AU FORMAT CIBLE (sharp) — port de buildMattedOeuvre du navigateur ----------
   On construit la toile au format DU POSTER (3:4 portrait / 4:3 paysage), PAS au ratio natif de
   l'œuvre : sinon le smart object recadre la bordure sur l'axe en trop. COVER de l'œuvre dans le
   cadre intérieur (léger rognage accepté), marge blanche égale sur 4 côtés. */
async function buildMattedOeuvre(artworkBuf, targetRatio) {
  const meta = await sharp(artworkBuf).metadata()
  const aw = meta.width
  const ah = meta.height
  if (!aw || !ah) throw new Error('œuvre illisible')
  let W, H
  if (targetRatio >= 1) {
    W = aw
    H = Math.round(aw / targetRatio)
  } else {
    H = ah
    W = Math.round(ah * targetRatio)
  }
  const m = Math.round(PP_RATIO * Math.min(W, H))
  const iw = W - 2 * m
  const ih = H - 2 * m
  const inner = await sharp(artworkBuf)
    .resize(iw, ih, { fit: 'cover', position: 'center' })
    .toBuffer()
  return await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: inner, left: m, top: m }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

/* ---------- fetch d'une image (œuvre de la toile, en 2048px via le CDN Shopify) ---------- */
async function fetchImageBuffer(url) {
  const sep = url.includes('?') ? '&' : '?'
  const r = await fetch(url + sep + 'width=2048')
  if (!r.ok) throw new Error('œuvre introuvable (' + r.status + ')')
  const mime = r.headers.get('content-type') || 'image/jpeg'
  const buf = Buffer.from(await r.arrayBuffer())
  return { buf, mime }
}

const toDataUrl = (buf, mime) => `data:${mime || 'image/jpeg'};base64,${buf.toString('base64')}`

/* ---------- assemble le tableau d'images du payload (mockups + œuvre + jumeaux) ---------- */
async function buildPosterImages(deps, artworkUrl, ratio) {
  const { buf: artworkBuf, mime: artMime } = await fetchImageBuffer(artworkUrl)
  const favorites = await loadPhotopeaFavorites(deps.readSaved, ratio)
  if (!favorites.length) {
    throw new Error('Aucun favori ★ poster Photopea pour ce ratio — configure-les dans le studio')
  }

  // 1) mockups (PSD favoris)
  const mockups = []
  for (const t of favorites) {
    const buf = await renderPsdBuffer(deps, t.psd, artworkBuf, artMime)
    mockups.push({ buf, context: t.context || t.subName || 'Mockup', psd: t.psd, clientId: uid() })
  }

  // 2) jumeaux passe-partout : même PSD, œuvre mat-ée au format cible
  const targetRatio = ratio === 'landscape' ? 4 / 3 : 3 / 4
  const matted = await buildMattedOeuvre(artworkBuf, targetRatio)
  const twins = []
  for (const m of mockups) {
    const buf = await renderPsdBuffer(deps, m.psd, matted, 'image/jpeg')
    twins.push({ buf, context: m.context, passePartoutOf: m.clientId })
  }

  // 3) ordre payload : [mockup1, original, mockup2, ...] puis jumeaux en fin
  const imgs = []
  for (let k = 0; k < mockups.length; k++) {
    const m = mockups[k]
    imgs.push({
      base64Image: toDataUrl(m.buf, 'image/jpeg'),
      type: 'mockup',
      mockupContext: m.context,
      clientId: m.clientId,
    })
    if (k === 0) imgs.push({ base64Image: toDataUrl(artworkBuf, artMime), type: 'original' })
  }
  for (const t of twins) {
    imgs.push({
      base64Image: toDataUrl(t.buf, 'image/jpeg'),
      type: 'mockup',
      mockupContext: t.context,
      passePartout: true,
      passePartoutOf: t.passePartoutOf,
    })
  }
  return imgs
}

/* ---------- appels backend (jeton de service x-bulk-token) ---------- */
function ensureConfig(config) {
  if (!config || !config.token) {
    throw new Error('BULK_POSTERS_TOKEN non configuré sur le moteur de rendu (.env)')
  }
  if (!config.backendBase) throw new Error('BACKEND_BASE non configuré sur le moteur de rendu (.env)')
}
async function backendPost(config, path, body) {
  ensureConfig(config)
  const r = await fetch(config.backendBase + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-bulk-token': config.token,
    },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.success === false) {
    throw new Error(data.message || data.error || `backend ${path} HTTP ${r.status}`)
  }
  return data
}
async function backendGet(config, path) {
  ensureConfig(config)
  const r = await fetch(config.backendBase + path, {
    headers: { Accept: 'application/json', 'x-bulk-token': config.token },
  })
  const data = await r.json().catch(() => ({}))
  return { status: r.status, ok: r.ok, data }
}

/* ---------- attend que le brouillon ait ses N variantes (webhook async) ---------- */
async function pollComplete(config, productId, ratio) {
  const deadline = Date.now() + POLL_MAX_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL)
    let res
    try {
      res = await backendGet(
        config,
        '/api/bulk-posters/status?productId=' +
          encodeURIComponent(productId) +
          '&ratio=' +
          encodeURIComponent(ratio)
      )
    } catch {
      continue
    }
    const data = res.data
    if (res.ok && data && data.success && data.data) {
      if (!data.data.exists) throw new Error('brouillon disparu')
      if (data.data.complete) return true
    }
  }
  return false
}

/* ---------- une toile : rendu + create-one (COPIE) + poll + finalize (2 tentatives) ----------
   Retour : { status, productId?, error?, colorThemeFromAI?, note? }
     - 'published' : poster en ligne, lié. ✅
     - 'cap'       : variantes pas créées dans le délai → cap quotidien probable. Brouillon gardé.
                     L'agent S'ARRÊTE (créer plus ne ferait que des brouillons incomplets).
     - 'kept'      : finalize a échoué APRÈS une possible publication → on NE supprime PAS (le produit
                     peut être en ligne). Le brouillon est gardé ; la reprise (finalize-pending,
                     finalize idempotent) re-posera les liens. L'agent LOGUE et CONTINUE.
     - 'failed'    : échec AVANT finalize (rendu/create/poll) → brouillon supprimé (rien d'incomplet).
                     L'agent LOGUE et CONTINUE.

   IMPORTANT (tout-ou-rien) : delete-draft n'est déclenché QUE pour un échec AVANT finalize (le
   brouillon n'est alors jamais publié). Un échec PENDANT/APRÈS finalize ne supprime JAMAIS (sinon on
   détruirait un produit déjà rendu ACTIVE + publié). Les images sont rendues UNE fois et réutilisées
   entre tentatives (pas de re-rendu coûteux ; borne la durée de l'appel). */
async function runOne(deps, body) {
  const {
    toileId,
    artworkUrl,
    ratio,
    collectionId,
    collectionTitle,
    title,
    descriptionHtml,
    seoTitle,
    seoDescription,
  } = body || {}
  if (
    !toileId ||
    !artworkUrl ||
    (ratio !== 'portrait' && ratio !== 'landscape') ||
    !collectionId ||
    !title ||
    !descriptionHtml ||
    !seoTitle ||
    !seoDescription
  ) {
    return {
      status: 'failed',
      error:
        'paramètres manquants (toileId, artworkUrl, ratio[portrait|landscape], collectionId, title, descriptionHtml, seoTitle, seoDescription)',
    }
  }

  const { config } = deps
  let lastErr = null
  let images = null // rendu UNE fois, réutilisé entre tentatives
  let colorThemeFromAI = false

  for (let attempt = 1; attempt <= 2; attempt++) {
    let productId = null
    try {
      if (!images) images = await buildPosterImages(deps, artworkUrl, ratio)
      const created = await backendPost(config, '/api/bulk-posters/create-one', {
        toileId,
        ratio,
        collectionId,
        collectionTitle: collectionTitle || '',
        title,
        descriptionHtml,
        seoTitle,
        seoDescription,
        images,
      })
      productId = created.productId
      if (!productId) throw new Error('create-one : pas de productId renvoyé')
      colorThemeFromAI = created.colorThemeFromAI === true

      const complete = await pollComplete(config, productId, ratio)
      if (!complete) return { status: 'cap', productId, colorThemeFromAI } // brouillon gardé
    } catch (e) {
      lastErr = e
      // Échec AVANT finalize (rendu/create/poll) : le brouillon n'est jamais publié → suppression sûre.
      if (productId) {
        try {
          await backendPost(config, '/api/bulk-posters/delete-draft', { productId, toileId })
        } catch {
          /* best-effort */
        }
      }
      continue // nouvelle tentative (réutilise les images déjà rendues)
    }

    // Brouillon complet, PAS encore finalisé. finalize est HORS du catch destructif : une fois
    // publishProductOnAll passé, le produit peut être EN LIGNE → on ne le supprime JAMAIS sur échec.
    try {
      const fin = await backendPost(config, '/api/bulk-posters/finalize', { toileId, productId, ratio })
      if (fin.published) return { status: 'published', productId, colorThemeFromAI }
      if (fin.pending) return { status: 'cap', productId, colorThemeFromAI }
      if (fin.missing) {
        return { status: 'failed', productId, error: 'brouillon disparu pendant finalize', colorThemeFromAI }
      }
      return { status: 'kept', productId, colorThemeFromAI, note: 'finalize non publié — à reprendre' }
    } catch (finErr) {
      // finalize a jeté APRÈS une possible publication : NE PAS supprimer. Reprise via finalize-pending.
      return {
        status: 'kept',
        productId,
        colorThemeFromAI,
        note: 'finalize à reprendre : ' + (finErr && finErr.message ? finErr.message : finErr),
      }
    }
  }
  return { status: 'failed', error: lastErr ? lastErr.message : 'échec inconnu' }
}

/* ---------- finalise un brouillon déjà créé (reprise après cap, aucun re-rendu) ---------- */
async function finalizePending(deps, body) {
  const { toileId, posterId, ratio } = body || {}
  if (!toileId || !posterId || (ratio !== 'portrait' && ratio !== 'landscape')) {
    return { status: 'error', error: 'toileId, posterId, ratio[portrait|landscape] requis' }
  }
  try {
    const fin = await backendPost(deps.config, '/api/bulk-posters/finalize', {
      toileId,
      productId: posterId,
      ratio,
    })
    if (fin.published) return { status: 'published', productId: posterId }
    if (fin.missing) return { status: 'missing', productId: posterId }
    return { status: 'cap', productId: posterId } // pending / pas encore complet
  } catch (e) {
    return { status: 'error', error: e.message }
  }
}

/* ---------- wiring Express ---------- */
function registerBulkPostersRoutes(app, deps) {
  // Proxy candidates : le moteur détient le jeton -> l'agent n'a qu'UNE origine (localhost:4000).
  app.get('/api/bulk-posters/candidates', async (req, res) => {
    try {
      let path = '/api/bulk-posters/candidates?ratio=' + encodeURIComponent(req.query.ratio || '')
      if (req.query.limit) path += '&limit=' + encodeURIComponent(req.query.limit)
      const { status, data } = await backendGet(deps.config, path)
      res.status(status).json(data)
    } catch (e) {
      res.status(500).json({ success: false, error: e.message })
    }
  })

  // Une toile : rendu + COPIE + publication (tout-ou-rien). L'agent fait 1 appel par toile.
  // Appel LONG (plusieurs rendus Photopea sérialisés + poll jusqu'à 120s) : on désactive tout timeout
  // de socket côté serveur pour cette requête, afin que le serveur ne coupe JAMAIS avant le client.
  app.post('/api/bulk-posters/run-one', async (req, res) => {
    req.setTimeout(0)
    res.setTimeout(0)
    try {
      res.json(await runOne(deps, req.body || {}))
    } catch (e) {
      res.status(500).json({ status: 'failed', error: e.message })
    }
  })

  // Reprise d'un brouillon en attente (cap d'un run précédent).
  app.post('/api/bulk-posters/finalize-pending', async (req, res) => {
    try {
      res.json(await finalizePending(deps, req.body || {}))
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message })
    }
  })
}

module.exports = { registerBulkPostersRoutes }
