/* ===== MyselfMonArt — Posters en masse depuis les toiles (orchestrateur navigateur) =====
   Pour chaque toile éligible (par ratio) : on récupère l'œuvre, on applique les FAVORIS ★ poster
   (mockups Photopea + décors IA) + les jumeaux passe-partout, on crée un BROUILLON via le studio
   (draft:true), on attend ses 7 variantes, puis on FINALISE (publie + lie toile↔poster).

   TOUT OU RIEN : un poster n'est publié que 100 % complet. 2 tentatives par toile ; échec définitif
   -> brouillon supprimé + toile dans la liste d'échecs (relançable). Cap atteint -> brouillon gardé
   (caché), finalisé au prochain lancement, sans re-rendu.

   NB : les helpers de rendu sont volontairement RÉPLIQUÉS depuis public/app.js (le studio). Garder
   les deux en phase si la logique de rendu/insertion/jumeaux évolue. */

const $ = (s, r = document) => r.querySelector(s)
const CFG = window.PUBLISHER_CONFIG || {}
const RENDER = (CFG.renderBase || '').replace(/\/$/, '') // moteur de rendu (PC, via tunnel en prod)
const API = (CFG.apiBase || '').replace(/\/$/, '') // backend (collections/publish/bulk). '' = même origine
const renderUrl = (p) => RENDER + p
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const PP_RATIO = 0.08 // bordure passe-partout = 8 % du petit côté (identique au studio)
const POLL_INTERVAL = 4000
const POLL_MAX_MS = 120000 // au-delà : variantes non créées -> on considère le cap quotidien atteint
const FAILED_KEY = 'bulkPostersFailed'

const state = { running: false, cancel: false, ratio: 'portrait', saved: { photopea: [], ai: [] } }

/* ---------- helpers réutilisés du studio (app.js) ---------- */
async function urlToDataUrl(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('image introuvable (' + resp.status + ')')
  const blob = await resp.blob()
  return await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onloadend = () => res(fr.result)
    fr.onerror = () => rej(new Error('lecture image échouée'))
    fr.readAsDataURL(blob)
  })
}
const toB64 = urlToDataUrl // fetch gère aussi bien une URL servie qu'une data URI

// Insertion IA d'une œuvre dans un décor (job + polling), comme le studio.
async function callInsertJob(body) {
  const startRes = await fetch(API + '/api/insert-artwork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const startData = await startRes.json().catch(() => ({}))
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Insertion : démarrage impossible')
  }
  const startedAt = Date.now()
  const MAX_MS = 11 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error('Insertion expirée')
    await sleep(3000)
    let res, data
    try {
      res = await fetch(API + '/api/insert-artwork/result?id=' + encodeURIComponent(jobId), {
        headers: { Accept: 'application/json' },
      })
      data = await res.json()
    } catch {
      if (++netErrors > 6) throw new Error('Connexion interrompue (insertion)')
      continue
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found') throw new Error('Session insertion expirée')
    if (data.status === 'error') throw new Error(data.message || 'Échec insertion')
    if (data.status === 'done' && data.data && data.data.image) return data.data.image
  }
}

// Rendu d'un mockup Photopea (PSD favori) avec l'œuvre.
async function renderPsd(psd, image, mockupContext) {
  const r = await fetch(RENDER + '/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ psd, image, mockupContext }),
  })
  const data = await r.json()
  if (!data.success) throw new Error(data.error || 'échec du rendu')
  return { url: renderUrl(data.url), context: data.mockupContext }
}

// Œuvre « mat-ée » (marge blanche, COVER) pour le jumeau passe-partout — canvas, sans IA.
function buildMattedOeuvre(srcDataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const W = img.naturalWidth,
        H = img.naturalHeight
      const m = Math.round(PP_RATIO * Math.min(W, H))
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      const iw = W - 2 * m,
        ih = H - 2 * m
      const scale = Math.max(iw / W, ih / H)
      const dw = W * scale,
        dh = H * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(m, m, iw, ih)
      ctx.clip()
      ctx.drawImage(img, m + (iw - dw) / 2, m + (ih - dh) / 2, dw, dh)
      ctx.restore()
      resolve(c.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => reject(new Error('œuvre illisible'))
    img.src = srcDataUrl
  })
}

// Jumeau passe-partout d'un mockup : ré-applique le MÊME moteur (PSD ou décor IA) à l'œuvre mat-ée.
async function buildTwin(mockup, mattedArtwork) {
  if (mockup.psd) {
    const r = await renderPsd(mockup.psd, mattedArtwork, mockup.context)
    return r.url
  }
  return await callInsertJob({
    decor: mockup.decor,
    artwork: mattedArtwork,
    target: state.ratio,
    product: 'poster',
    fidelity: mockup.fidelity || 'standard',
    mat: true, // l'œuvre est déjà mat-ée -> le backend préserve la marge blanche
  })
}

async function loadSavedTemplates() {
  const r = await fetch(RENDER + '/api/saved-templates')
  const data = await r.json()
  state.saved = { photopea: data.photopea || [], ai: data.ai || [] }
}

// Favoris ★ poster pour le ratio courant (mêmes filtres que le lot auto du studio).
function posterFavorites() {
  const ori = state.ratio
  const pp = state.saved.photopea.filter(
    (t) =>
      (!t.type || t.type === 'poster') &&
      (!(t.orientations && t.orientations[0]) || t.orientations[0] === ori)
  )
  const ai = state.saved.ai.filter(
    (t) => t.favorite && (!t.product || t.product === 'poster') && (!t.orientation || t.orientation === ori)
  )
  return { pp, ai }
}

/* ---------- pipeline par toile ---------- */
// Rend tous les mockups (favoris + jumeaux) et assemble le tableau d'images du payload studio.
async function buildPosterImages(toile, onStep) {
  const sep = toile.artworkUrl.includes('?') ? '&' : '?'
  const artwork = await urlToDataUrl(toile.artworkUrl + sep + 'width=2048')
  const { pp, ai } = posterFavorites()
  if (!pp.length && !ai.length) {
    throw new Error('Aucun favori ★ poster pour ce ratio — configure-les dans le studio')
  }

  const mockups = []
  let i = 0
  const tot = pp.length + ai.length
  for (const t of pp) {
    onStep && onStep(`mockup ${++i}/${tot}`)
    const m = await renderPsd(t.psd, artwork, t.context || t.subName)
    mockups.push({ url: m.url, context: m.context || t.subName || 'Mockup', psd: t.psd, clientId: uid() })
  }
  for (const t of ai) {
    onStep && onStep(`mockup ${++i}/${tot}`)
    const decor = await urlToDataUrl(renderUrl(t.url))
    const url = await callInsertJob({ decor, artwork, target: state.ratio, product: 'poster', fidelity: 'standard' })
    mockups.push({ url, context: 'Décor sur-mesure (IA)', decor, fidelity: 'standard', clientId: uid() })
  }

  // Jumeaux passe-partout (un par mockup), œuvre mat-ée.
  const matted = await buildMattedOeuvre(artwork)
  const twins = []
  let j = 0
  for (const m of mockups) {
    onStep && onStep(`passe-partout ${++j}/${mockups.length}`)
    const url = await buildTwin(m, matted)
    twins.push({ url, context: m.context, passePartoutOf: m.clientId })
  }

  // Ordre payload : [mockup1, original, mockup2, ...] puis jumeaux en fin.
  const imgs = []
  for (let k = 0; k < mockups.length; k++) {
    const m = mockups[k]
    imgs.push({ base64Image: await toB64(m.url), type: 'mockup', mockupContext: m.context, clientId: m.clientId })
    if (k === 0) imgs.push({ base64Image: artwork, type: 'original' })
  }
  for (const t of twins) {
    imgs.push({
      base64Image: await toB64(t.url),
      type: 'mockup',
      mockupContext: t.context,
      passePartout: true,
      passePartoutOf: t.passePartoutOf,
    })
  }
  return imgs
}

async function createDraft(toile, imgs) {
  const payload = {
    images: imgs,
    ratio: state.ratio,
    productType: 'poster',
    parentCollection: { id: toile.collectionId, title: toile.collectionTitle },
    idempotencyKey: 'bp_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    draft: true,
    linkedPaintingId: toile.toileId,
  }
  const r = await fetch(API + '/api/shopify-product-publisher/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.success !== true) {
    throw new Error(data.message || data.error || 'Création brouillon : HTTP ' + r.status)
  }
  if (!data.productId) throw new Error('Création brouillon : pas de productId renvoyé')
  return data.productId
}

// Attend que le brouillon ait ses N variantes. false = pas complet dans le délai (cap probable).
async function pollComplete(productId) {
  const deadline = Date.now() + POLL_MAX_MS
  while (Date.now() < deadline) {
    if (state.cancel) throw new Error('annulé')
    await sleep(POLL_INTERVAL)
    let data
    try {
      const r = await fetch(
        API + '/api/bulk-posters/status?productId=' + encodeURIComponent(productId) + '&ratio=' + state.ratio,
        { headers: { Accept: 'application/json' } }
      )
      data = await r.json()
    } catch {
      continue
    }
    if (data && data.success && data.data) {
      if (!data.data.exists) throw new Error('brouillon disparu')
      if (data.data.complete) return true
    }
  }
  return false
}

async function finalize(toileId, productId) {
  const r = await fetch(API + '/api/bulk-posters/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ toileId, productId, ratio: state.ratio }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.success !== true) throw new Error(data.message || 'Finalize : HTTP ' + r.status)
  return data // { published } | { pending } | { missing }
}

async function deleteDraft(productId, toileId) {
  try {
    await fetch(API + '/api/bulk-posters/delete-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, toileId }),
    })
  } catch {
    /* best-effort */
  }
}

// Traite une toile (2 tentatives). Retour : { status, draftCreated, error }
// status : 'published' | 'cap' (brouillon gardé, variantes en attente) | 'failed'
async function processToile(toile, onStep) {
  let lastErr = null
  let draftCreated = false
  if (!toile.collectionId) {
    return { status: 'failed', draftCreated, error: 'toile sans collection mère — impossible de publier' }
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (state.cancel) return { status: 'cancelled', draftCreated }
    let productId = null
    try {
      onStep && onStep(attempt > 1 ? 'rendu (tentative 2)…' : 'rendu des mockups…')
      const imgs = await buildPosterImages(toile, onStep)
      onStep && onStep('création du brouillon…')
      productId = await createDraft(toile, imgs)
      draftCreated = true
      onStep && onStep('attente des variantes…')
      const complete = await pollComplete(productId)
      if (!complete) return { status: 'cap', draftCreated, productId } // brouillon gardé, repris plus tard
      onStep && onStep('publication…')
      const fin = await finalize(toile.toileId, productId)
      if (fin.published) return { status: 'published', draftCreated, productId }
      if (fin.pending) return { status: 'cap', draftCreated, productId }
      // missing / autre -> on retente
      lastErr = new Error('finalize non publié')
    } catch (e) {
      lastErr = e
      // tout ou rien : on supprime le brouillon raté — sauf en cas d'annulation, où on le GARDE
      // (marqueur poster_draft -> finalisable à la reprise, pas de re-rendu perdu).
      if (productId && !state.cancel) await deleteDraft(productId, toile.toileId)
    }
  }
  // Échec après 2 tentatives : rien d'incomplet ne reste (brouillon supprimé dans le catch).
  return { status: 'failed', draftCreated, error: lastErr ? lastErr.message : 'échec inconnu' }
}

// Finalise un brouillon déjà créé (reprise) — aucun re-rendu.
async function processPending(p) {
  try {
    const fin = await finalize(p.toileId, p.posterId)
    if (fin.published) return 'published'
    if (fin.missing) return 'missing'
    return 'cap' // toujours pas complet
  } catch {
    return 'error'
  }
}

/* ---------- liste d'échecs (localStorage, survit aux jours) ---------- */
function loadFailed() {
  try {
    return JSON.parse(localStorage.getItem(FAILED_KEY) || '[]')
  } catch {
    return []
  }
}
function saveFailed(list) {
  localStorage.setItem(FAILED_KEY, JSON.stringify(list))
  renderFailed()
}
function addFailed(toile, error) {
  const list = loadFailed().filter((f) => f.toileId !== toile.toileId)
  list.push({ ...toile, error, date: new Date().toISOString() })
  saveFailed(list)
}
function removeFailed(toileId) {
  saveFailed(loadFailed().filter((f) => f.toileId !== toileId))
}

/* ---------- UI ---------- */
const ui = {
  status: () => $('#bp-status'),
  counts: () => $('#bp-counts'),
  log: () => $('#bp-log'),
}
function setStatus(msg) {
  ui.status().textContent = msg
}
function logLine(msg, kind) {
  const li = document.createElement('li')
  li.className = 'bp-log-line' + (kind ? ' ' + kind : '')
  li.textContent = msg
  ui.log().prepend(li)
}
function setCounts(c) {
  ui.counts().textContent =
    `Publiés : ${c.published} · En attente (cap) : ${c.cap} · Échecs : ${c.failed} · Restants : ${c.remaining}`
}
function renderFailed() {
  const box = $('#bp-failed')
  const list = loadFailed()
  $('#bp-failed-count').textContent = list.length
  const tbody = $('#bp-failed-list')
  tbody.innerHTML = ''
  box.classList.toggle('hidden', list.length === 0)
  for (const f of list) {
    const tr = document.createElement('tr')
    tr.innerHTML =
      `<td>${escapeHtml(f.title || f.toileId)}</td>` +
      `<td class="bp-err">${escapeHtml(f.error || '')}</td>` +
      `<td><button class="ghost-btn bp-retry-one" data-id="${escapeHtml(f.toileId)}">Relancer</button></td>`
    tbody.appendChild(tr)
  }
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function setRunning(on) {
  state.running = on
  $('#bp-run').disabled = on
  $('#bp-stop').disabled = !on
  $('#bp-ratio').disabled = on
  $('#bp-count').disabled = on
  $('#bp-test-ids').disabled = on
}

/* ---------- boucle principale ---------- */
async function runBatch(retryList) {
  if (state.running) return
  state.cancel = false
  setRunning(true)
  const counts = { published: 0, cap: 0, failed: 0, remaining: 0 }
  try {
    state.ratio = $('#bp-ratio').value
    const count = parseInt($('#bp-count').value, 10) || 0 // 0 = tout
    const testIds = ($('#bp-test-ids').value || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    setStatus('Chargement des favoris ★…')
    await loadSavedTemplates()
    const fav = posterFavorites()
    if (!fav.pp.length && !fav.ai.length) {
      setStatus('Aucun favori ★ poster pour ce ratio. Configure-les dans le studio puis relance.')
      setRunning(false)
      return
    }

    let pending = []
    let todo = []
    if (retryList) {
      // Relance ciblée depuis la liste d'échecs.
      todo = retryList
      setStatus(`Relance de ${todo.length} toile(s) en échec…`)
    } else {
      setStatus('Recherche des toiles éligibles…')
      const r = await fetch(API + '/api/bulk-posters/candidates?ratio=' + state.ratio, {
        headers: { Accept: 'application/json' },
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.success) throw new Error((data && data.message) || 'Recherche des toiles impossible')
      pending = data.data.pending || []
      todo = data.data.candidates || []
      const skipped = data.data.skipped || []
      if (skipped.length) {
        logLine(`↷ ${skipped.length} toile(s) sautée(s) : pas de collection poster équivalente`)
      }
      if (testIds.length) {
        const want = new Set(testIds.map((id) => (id.startsWith('gid://') ? id : 'gid://shopify/Product/' + id)))
        todo = todo.filter((t) => want.has(t.toileId))
      }
    }

    // 1) Finaliser d'abord les brouillons en attente (aucun re-rendu) — reprise après cap.
    for (const p of pending) {
      if (state.cancel) break
      setStatus(`Reprise du brouillon : ${p.title || p.toileId}`)
      const res = await processPending(p)
      if (res === 'published') {
        counts.published++
        logLine('✓ (repris) ' + (p.title || p.toileId), 'ok')
      } else if (res === 'cap') {
        counts.cap++
        logLine('⏳ encore en attente : ' + (p.title || p.toileId))
      } else if (res === 'missing') {
        logLine('↪ brouillon disparu, toile rouverte : ' + (p.title || p.toileId))
      } else {
        logLine('⚠ reprise impossible : ' + (p.title || p.toileId), 'err')
      }
      setCounts({ ...counts, remaining: todo.length })
    }

    // 2) Créer les nouveaux posters jusqu'au compteur, ou jusqu'au cap.
    let createdDrafts = 0
    for (let idx = 0; idx < todo.length; idx++) {
      if (state.cancel) break
      if (count && createdDrafts >= count) {
        setStatus(`Compteur atteint (${count}). Arrêt propre.`)
        break
      }
      const toile = todo[idx]
      counts.remaining = todo.length - idx
      setCounts(counts)
      setStatus(`(${idx + 1}/${todo.length}) ${toile.title || toile.toileId}`)
      const res = await processToile(toile, (step) =>
        setStatus(`(${idx + 1}/${todo.length}) ${toile.title || toile.toileId} — ${step}`)
      )
      if (state.cancel) break // annulation pendant la toile : on s'arrête sans la classer en échec
      if (res.draftCreated) createdDrafts++
      if (res.status === 'published') {
        counts.published++
        logLine('✓ ' + (toile.title || toile.toileId), 'ok')
        if (retryList) removeFailed(toile.toileId)
      } else if (res.status === 'cap') {
        counts.cap++
        logLine('⏳ cap atteint — brouillon gardé : ' + (toile.title || toile.toileId))
        setStatus('Cap quotidien atteint. Brouillon(s) gardé(s). Relance demain pour finir.')
        break // on arrête : créer plus ne ferait que des brouillons incomplets
      } else {
        counts.failed++
        addFailed(toile, res.error)
        logLine('✗ ' + (toile.title || toile.toileId) + ' — ' + res.error, 'err')
      }
      setCounts(counts)
    }

    if (!state.cancel && !(counts.cap > 0)) {
      setStatus(`Terminé. Publiés : ${counts.published} · Échecs : ${counts.failed}.`)
    } else if (state.cancel) {
      setStatus('Arrêté.')
    }
  } catch (e) {
    setStatus('Erreur : ' + (e && e.message ? e.message : e))
  } finally {
    setCounts(counts)
    setRunning(false)
  }
}

/* ---------- wiring ---------- */
$('#bp-run').addEventListener('click', () => runBatch(null))
$('#bp-stop').addEventListener('click', () => {
  state.cancel = true
  setStatus('Arrêt demandé… (fin de la toile en cours)')
})
$('#bp-failed-retry-all').addEventListener('click', () => {
  const list = loadFailed()
  if (list.length) runBatch(list)
})
$('#bp-failed-clear').addEventListener('click', () => {
  if (confirm('Vider la liste des échecs ?')) saveFailed([])
})
$('#bp-failed-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.bp-retry-one')
  if (!btn) return
  const f = loadFailed().find((x) => x.toileId === btn.dataset.id)
  if (f) runBatch([f])
})

renderFailed()
setStatus('Prêt. Choisis un ratio et lance.')
