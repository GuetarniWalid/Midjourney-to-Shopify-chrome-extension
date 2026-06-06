/* ===== MyselfMonArt Publisher — logique front (mobile + desktop) ===== */
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]

/* Config injectable par l'hôte (le backend met window.PUBLISHER_CONFIG dans la page).
   - RENDER : moteur de rendu sur le PC (templates, render, fichiers). Via tunnel en prod.
   - API    : backend MyselfMonArt (collections, publish). Vide = même origine que la page. */
const CFG = window.PUBLISHER_CONFIG || {}
const RENDER = (CFG.renderBase || '').replace(/\/$/, '') // ex: https://xxx.trycloudflare.com ; '' = même origine (test local)
const API = (CFG.apiBase || '').replace(/\/$/, '') // ex: '' (backend sert la page) ou http://localhost:3333
// helper pour préfixer une URL relative (/uploads/.. , /mockups/..) par le moteur de rendu
const renderUrl = (p) => RENDER + p
// type produit (UI en FR) -> enum backend
const TYPE_MAP = { toile: 'painting', poster: 'poster', tapisserie: 'tapestry' }
// type produit (UI) <-> "product" des décors IA (canvas/poster/tapestry)
const productOf = (t) => (t === 'poster' ? 'poster' : t === 'tapisserie' ? 'tapestry' : 'canvas')
const PRODUCT_TO_TYPE = { canvas: 'toile', poster: 'poster', tapestry: 'tapisserie' }

const state = {
  imageDataUrl: null, // l'oeuvre uploadée (dataURL)
  orientation: null, // 'portrait' | 'landscape' | 'square'
  productType: 'toile',
  collections: [],
  collection: null, // {id, title}
  templates: [], // catégories scannées
  results: [], // [{id, url, context, label}]
  saved: { photopea: [], ai: [] }, // templates sauvegardés "pour toujours"
  favPsds: new Set(), // chemins PSD favoris (pour l'état des étoiles)
}

/* ---------- Toast ---------- */
let toastT
function toast(msg, kind = '') {
  const el = $('#toast')
  el.textContent = msg
  el.className = 'toast ' + kind
  clearTimeout(toastT)
  toastT = setTimeout(() => el.classList.add('hidden'), 3200)
  el.classList.remove('hidden')
}

/* ---------- 1. Upload + détection orientation ---------- */
const fileInput = $('#fileInput'),
  dropzone = $('#dropzone'),
  dzInner = $('#dzInner'),
  sourcePreview = $('#sourcePreview'),
  changeBtn = $('#changeImageBtn')

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadImageFile(e.target.files[0])
})
changeBtn.addEventListener('click', () => fileInput.click())
;['dragover', 'dragenter'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault()
    dropzone.classList.add('drag')
  })
)
;['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault()
    dropzone.classList.remove('drag')
  })
)
dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0]
  if (f) loadImageFile(f)
})

function loadImageFile(file) {
  if (!file.type.startsWith('image/')) return toast('Fichier non image', 'err')
  const reader = new FileReader()
  reader.onload = () => {
    state.imageDataUrl = reader.result
    const img = new Image()
    img.onload = () => {
      detectOrientation(img.naturalWidth, img.naturalHeight)
      sourcePreview.src = reader.result
      sourcePreview.classList.remove('hidden')
      dzInner.classList.add('hidden')
      changeBtn.classList.remove('hidden')
      const dv = $('#decorVibe')
      if (dv) dv.value = '' // reset l'orientation décor entre deux œuvres
      state.decor = null
      renderMockups()
      renderSavedTemplates()
      refreshAction()
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

// Ratio cible exact par orientation
const TARGET_RATIO = { portrait: 3 / 4, square: 1, landscape: 4 / 3 }
// Classe l'image et détermine s'il faut la retailler (mauvais format pour son orientation).
function detectOrientation(w, h) {
  const ratio = w / h
  let ori, label
  // near-square élargi (±10%) -> cible carré ; sinon portrait/paysage
  if (ratio >= 0.9 && ratio <= 1.1) {
    ori = 'square'; label = 'Carré'
  } else if (ratio < 0.9) {
    ori = 'portrait'; label = 'Portrait'
  } else {
    ori = 'landscape'; label = 'Paysage'
  }
  // déjà au bon format ? tolérance relative 3% vs le ratio cible de sa classe
  const target = TARGET_RATIO[ori]
  const needsResize = Math.abs(ratio - target) / target > 0.03

  state.orientation = ori
  state.sourceRatio = ratio
  state.needsResize = needsResize
  const badge = $('#orientationBadge')
  badge.textContent = label
  badge.className = 'badge ' + ori
  badge.classList.remove('hidden')
  updateRatioUI() // overlay grille + bouton retailler
}

// Affiche/masque l'overlay quadrillé (cadre cible) et le bouton "Retailler au bon format".
function updateRatioUI() {
  const overlay = $('#ratioOverlay')
  const btn = $('#resizeBtn')
  const warn = $('#ratioWarning')
  const hideAll = () => { overlay.classList.add('hidden'); btn.classList.add('hidden'); warn.classList.add('hidden') }
  if (!state.orientation) return hideAll()
  if (state.needsResize) {
    overlay.style.aspectRatio = String(TARGET_RATIO[state.orientation])
    overlay.classList.remove('hidden')
    warn.classList.remove('hidden')
    const labels = { portrait: '3:4', square: '1:1', landscape: '4:3' }
    btn.textContent = `Retailler en ${labels[state.orientation]}`
    btn.classList.remove('hidden')
  } else {
    hideAll()
  }
}

/* ---------- Retaillage de l'œuvre via GPT-image (preview low -> valider high) ---------- */
let lastResizedImage = null // dernier résultat (data URI) en attente de validation
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Cloudflare peut renvoyer une page HTML (524/502) au lieu de JSON -> parse défensif
async function safeJson(res) {
  try {
    return await res.json()
  } catch {
    return {}
  }
}
// Redimensionnement ASYNCHRONE : on démarre un job (réponse immédiate) puis on
// interroge son état en boucle. Chaque requête est courte -> jamais de 524 Cloudflare,
// quelle que soit la durée réelle de gpt-image-2.
// quality 'low'|'high' ; sourceImage = image à envoyer (défaut = l'originale uploadée) ;
// mode 'recompose' (recomposer l'original pour remplir le cadre) ou 'enhance' (re-rendu FIDÈLE
// de l'aperçu LOW déjà validé -> le HIGH est exactement le LOW validé, pas une nouvelle image).
async function callResize(quality, sourceImage, mode) {
  const startRes = await fetch(API + '/api/resize-artwork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: sourceImage || state.imageDataUrl,
      target: state.orientation,
      quality,
      mode: mode || 'recompose',
    }),
  })
  const startData = await safeJson(startRes)
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Impossible de démarrer (' + startRes.status + ')')
  }
  const startedAt = Date.now()
  // garde-fou navigateur : DOIT dépasser le timeout OpenAI back (580s) sinon on abandonnerait
  // un job que le worker va finir avec succès (résultat payant gâché). Reste sous le TTL serveur (15min).
  const MAX_MS = 11 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error('Le redimensionnement a expiré. Réessaye.')
    await sleep(quality === 'high' ? 3000 : 2000)
    let res, data
    try {
      res = await fetch(API + '/api/resize-artwork/result?id=' + encodeURIComponent(jobId))
      data = await safeJson(res)
    } catch (e) {
      if (++netErrors > 6) throw new Error('Connexion interrompue pendant la génération.')
      continue // coupure réseau transitoire -> on retente
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found')
      throw new Error('Session de génération expirée. Relance.')
    if (data.status === 'error') throw new Error(data.message || 'Échec du redimensionnement.')
    if (data.status === 'done' && data.data && data.data.image) return data.data.image
    // sinon: pending -> on continue la boucle
  }
}
function showResizeLoading(msg) {
  $('#resizeLoading').classList.remove('hidden')
  $('#resizeLoadingMsg').textContent = msg
  $('#resizeCompare').classList.add('hidden')
  $('#resizeActions').classList.add('hidden')
  $('#resizeFinal').classList.add('hidden')
}
async function runResizePreview() {
  $('#resizeOverlay').classList.remove('hidden')
  $('#resizeBefore').src = state.imageDataUrl
  showResizeLoading('Génération de l\'aperçu… (~20-30s)')
  try {
    lastResizedImage = await callResize('low')
    $('#resizeAfter').src = lastResizedImage
    $('#resizeLoading').classList.add('hidden')
    $('#resizeCompare').classList.remove('hidden')
    $('#resizeActions').classList.remove('hidden')
  } catch (e) {
    $('#resizeOverlay').classList.add('hidden')
    toast("Échec de l'aperçu : " + e.message, 'err')
  }
}
$('#resizeBtn').addEventListener('click', runResizePreview)
$('#resizeRetry').addEventListener('click', runResizePreview)
$('#resizeCancel').addEventListener('click', () => { $('#resizeOverlay').classList.add('hidden'); lastResizedImage = null })
// HIGH = on AMÉLIORE l'aperçu LOW déjà validé (envoyé comme image source, mode 'enhance') pour
// obtenir EXACTEMENT la même image en haute qualité, sans recomposition ni retouche créative.
// Le re-roll repart TOUJOURS du LOW validé (jamais d'une sortie HIGH) -> pas de dégradation cumulative.
async function runResizeHigh() {
  if (!lastResizedImage) return runResizePreview() // sécurité : pas d'aperçu validé -> on (re)fait l'aperçu
  showResizeLoading('Génération en haute qualité… (peut prendre 1-2 min)')
  try {
    const hi = await callResize('high', lastResizedImage, 'enhance')
    applyResizedImage(hi)
    $('#resizeBefore').src = lastResizedImage // compare l'aperçu validé (gauche) au rendu HQ (droite)
    $('#resizeAfter').src = hi
    $('#resizeCompare').classList.remove('hidden')
    $('#resizeLoading').classList.add('hidden')
    $('#resizeFinal').classList.remove('hidden')
  } catch (e) {
    // récupération propre : on stoppe le spinner et on revient aux actions (re-tentable)
    $('#resizeLoading').classList.add('hidden')
    $('#resizeAfter').src = lastResizedImage // ré-affiche l'aperçu validé
    $('#resizeCompare').classList.remove('hidden')
    $('#resizeActions').classList.remove('hidden')
    toast('Échec haute qualité : ' + e.message, 'err')
  }
}
// Valider ET re-roll utilisent le même chemin (re-rendu fidèle depuis le LOW validé)
$('#resizeValidate').addEventListener('click', runResizeHigh)
$('#resizeRegenHigh').addEventListener('click', runResizeHigh)
$('#resizeClose').addEventListener('click', () => { $('#resizeOverlay').classList.add('hidden') })
// Remplace l'image uploadée par la version retaillée et relance la détection
function applyResizedImage(dataUrl) {
  state.imageDataUrl = dataUrl
  const img = new Image()
  img.onload = () => {
    detectOrientation(img.naturalWidth, img.naturalHeight)
    sourcePreview.src = dataUrl
    renderMockups()
    renderSavedTemplates()
    refreshAction()
  }
  img.src = dataUrl
}

/* ---------- Décor IA : génère un intérieur + cadre VIDE (full IA), l'œuvre s'insère à l'étape suivante ---------- */
let lastDecor = null // dernier décor généré : { image, product, theme, orientation } | null
function showDecorLoading(msg) {
  $('#decorLoading').classList.remove('hidden')
  $('#decorLoadingMsg').textContent = msg
  $('#decorResult').classList.add('hidden')
  $('#decorActions').classList.add('hidden')
  $('#decorStartActions').classList.add('hidden')
}
// démarre le job de génération de décor puis interroge son état (job + polling -> jamais de 524)
async function callDecorJob(body) {
  const startRes = await fetch(API + '/api/generate-decor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const startData = await safeJson(startRes)
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Impossible de démarrer (' + startRes.status + ')')
  }
  const startedAt = Date.now()
  const MAX_MS = 11 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error('La génération du décor a expiré. Réessaye.')
    await sleep(3000)
    let res, data
    try {
      res = await fetch(API + '/api/generate-decor/result?id=' + encodeURIComponent(jobId))
      data = await safeJson(res)
    } catch (e) {
      if (++netErrors > 6) throw new Error('Connexion interrompue pendant la génération.')
      continue
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found')
      throw new Error('Session de génération expirée. Relance.')
    if (data.status === 'error') throw new Error(data.message || 'Échec de la génération du décor.')
    if (data.status === 'done' && data.data && data.data.image) return data.data.image
  }
}
// Ouvre l'overlay en état "prêt" : le champ d'orientation + le bouton Générer sont visibles
// AVANT toute génération (on peut donc orienter dès le 1er décor).
function openDecorOverlay() {
  if (!state.imageDataUrl) return toast("Choisis une image d'abord", 'err')
  if (state.needsResize) return toast("Retaille d'abord l'image au bon format", 'err')
  $('#decorOverlay').classList.remove('hidden')
  $('#decorLoading').classList.add('hidden')
  $('#decorResult').classList.add('hidden')
  $('#decorActions').classList.add('hidden')
  $('#decorStartActions').classList.remove('hidden')
}
async function runDecorGenerate() {
  if (!state.imageDataUrl) return toast("Choisis une image d'abord", 'err')
  if (state.needsResize) return toast("Retaille d'abord l'image au bon format", 'err')
  showDecorLoading('Génération du décor sur-mesure… (~1-2 min)')
  try {
    const product = productOf(state.productType)
    const vibeEl = $('#decorVibe')
    const direction = vibeEl ? vibeEl.value.trim() : '' // orientation libre (raffinée côté serveur)
    const roomEl = $('#decorRoom')
    const roomType = roomEl && roomEl.value ? roomEl.value : null // '' = Auto -> le backend varie la pièce
    const image = await callDecorJob({
      image: state.imageDataUrl,
      target: state.orientation,
      product,
      theme: direction,
      roomType,
    })
    // On fige les métadonnées AU MOMENT de la génération (produit/thème/orientation réels de cette
    // image) pour qu'une sauvegarde ultérieure ne dérive pas si l'utilisateur change de type produit.
    lastDecor = { image, product, theme: direction || null, orientation: state.orientation }
    $('#decorImg').src = lastDecor.image
    $('#decorLoading').classList.add('hidden')
    $('#decorResult').classList.remove('hidden')
    $('#decorActions').classList.remove('hidden')
  } catch (e) {
    $('#decorLoading').classList.add('hidden')
    $('#decorStartActions').classList.remove('hidden') // retour à l'état prêt -> re-tentable
    toast('Décor : ' + e.message, 'err')
  }
}
$('#decorBtn').addEventListener('click', openDecorOverlay)
$('#decorGenerate').addEventListener('click', runDecorGenerate)
$('#decorRegen').addEventListener('click', runDecorGenerate)
$('#decorSave').addEventListener('click', saveAiDecor)
$('#decorCancel').addEventListener('click', () => {
  $('#decorOverlay').classList.add('hidden')
  lastDecor = null
})
$('#decorClose').addEventListener('click', () => {
  $('#decorOverlay').classList.add('hidden')
})
// Étape 1 -> 2 : on garde le décor validé puis on ouvre l'insertion (déclenchement explicite).
$('#decorValidate').addEventListener('click', () => {
  state.decor = lastDecor.image
  $('#decorOverlay').classList.add('hidden')
  openInsertOverlay()
})

/* ---------- Étape 2 : insertion de l'œuvre dans le décor validé (Nano Banana / Gemini) ---------- */
let lastInsert = null // dernier rendu d'insertion (data URI) en attente de validation
function showInsertLoading(msg) {
  $('#insertLoading').classList.remove('hidden')
  $('#insertLoadingMsg').textContent = msg
  $('#insertResult').classList.add('hidden')
  $('#insertStartActions').classList.add('hidden')
  $('#insertActions').classList.add('hidden')
}
function openInsertOverlay() {
  if (!state.decor || !state.imageDataUrl) return toast('Valide d’abord un décor', 'err')
  $('#insertOverlay').classList.remove('hidden')
  $('#insertLoading').classList.add('hidden')
  $('#insertResult').classList.add('hidden')
  $('#insertActions').classList.add('hidden')
  $('#insertStartActions').classList.remove('hidden') // "Insérer mon œuvre" + option haute fidélité
}
async function callInsertJob(body) {
  const startRes = await fetch(API + '/api/insert-artwork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const startData = await safeJson(startRes)
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Impossible de démarrer (' + startRes.status + ')')
  }
  const startedAt = Date.now()
  const MAX_MS = 11 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error('L’insertion a expiré. Réessaye.')
    await sleep(3000)
    let res, data
    try {
      res = await fetch(API + '/api/insert-artwork/result?id=' + encodeURIComponent(jobId))
      data = await safeJson(res)
    } catch (e) {
      if (++netErrors > 6) throw new Error('Connexion interrompue pendant l’insertion.')
      continue
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found') throw new Error('Session expirée. Relance.')
    if (data.status === 'error') throw new Error(data.message || 'Échec de l’insertion.')
    if (data.status === 'done' && data.data && data.data.image) return data.data.image
  }
}
// Re-roll : repart TOUJOURS du décor validé + l'œuvre d'origine (jamais d'un rendu précédent).
async function runInsertGenerate() {
  if (!state.decor || !state.imageDataUrl) return toast('Valide d’abord un décor', 'err')
  showInsertLoading('Insertion de votre œuvre dans le décor… (~1-2 min)')
  try {
    const product = productOf(state.productType)
    const fidelity = $('#insertHighFidelity') && $('#insertHighFidelity').checked ? 'high' : 'standard'
    lastInsert = await callInsertJob({
      decor: state.decor,
      artwork: state.imageDataUrl,
      target: state.orientation,
      product,
      fidelity,
    })
    $('#insertImg').src = lastInsert
    $('#insertLoading').classList.add('hidden')
    $('#insertResult').classList.remove('hidden')
    $('#insertActions').classList.remove('hidden')
  } catch (e) {
    $('#insertLoading').classList.add('hidden')
    $('#insertStartActions').classList.remove('hidden')
    toast('Insertion : ' + e.message, 'err')
  }
}
$('#insertGenerate').addEventListener('click', runInsertGenerate)
$('#insertRegen').addEventListener('click', runInsertGenerate)
$('#insertCancel').addEventListener('click', () => {
  $('#insertOverlay').classList.add('hidden')
  lastInsert = null
})
$('#insertClose').addEventListener('click', () => {
  $('#insertOverlay').classList.add('hidden')
})
// Valider le rendu final : il rejoint la galerie de rendus (publiable comme les mockups Photopea).
$('#insertValidate').addEventListener('click', () => {
  if (!lastInsert) return
  state.results.push({
    id: 'ins' + Date.now() + Math.random().toString(36).slice(2, 5),
    path: null,
    url: lastInsert,
    context: 'Décor sur-mesure (IA)',
    label: 'Décor IA',
  })
  renderResults()
  refreshAction()
  $('#insertOverlay').classList.add('hidden')
  lastInsert = null
  toast('Rendu ajouté à tes rendus ✓', 'ok')
})

/* ---------- 2. Type produit + collections ---------- */
$$('#productType .seg-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (state.productType === btn.dataset.type) return
    // changer de type = autres collections ET autres rendus -> on réinitialise les rendus générés
    if (
      state.results.length &&
      !confirm('Changer de type de produit va effacer les rendus déjà générés. Continuer ?')
    )
      return
    $$('#productType .seg-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    state.productType = btn.dataset.type
    clearResults()
    clearCollection()
    loadCollections()
    loadTemplates() // les mockups dépendent maintenant du type de produit
    renderSavedTemplates() // re-filtre les templates sauvegardés sur le nouveau type
  })
)

// Vide la galerie de rendus (et supprime les fichiers serveur correspondants)
function clearResults() {
  for (const r of state.results)
    fetch(RENDER + '/api/upload/' + r.url.split('/').pop(), { method: 'DELETE' }).catch(() => {})
  state.results = []
  renderResults()
  refreshAction()
}

const collSearch = $('#collectionSearch'),
  collList = $('#collectionList'),
  collChosen = $('#collectionChosen')

async function loadCollections() {
  state.collections = []
  try {
    const r = await fetch(`${API}/api/collections?type=${TYPE_MAP[state.productType]}`)
    const data = await r.json()
    state.collections =
      data && data.success && data.data ? data.data : Array.isArray(data) ? data : []
  } catch {
    state.collections = []
  }
  if (!state.collections.length)
    collSearch.placeholder = 'Collections indisponibles (backend hors-ligne)'
}

function clearCollection() {
  state.collection = null
  collChosen.classList.add('hidden')
  collChosen.innerHTML = ''
  collSearch.value = ''
  collSearch.classList.remove('hidden')
  refreshAction()
}

collSearch.addEventListener('input', () => {
  const term = collSearch.value.toLowerCase().trim()
  const list = term
    ? state.collections.filter((c) => (c.title || '').toLowerCase().includes(term))
    : state.collections
  collList.innerHTML =
    list
      .slice(0, 50)
      .map((c) => `<div class="combo-item" data-id="${c.id}">${escapeHtml(c.title)}</div>`)
      .join('') || `<div class="combo-item" style="color:var(--muted)">Aucune collection</div>`
  collList.classList.remove('hidden')
})
collSearch.addEventListener('focus', () => collSearch.dispatchEvent(new Event('input')))
collList.addEventListener('click', (e) => {
  const item = e.target.closest('.combo-item')
  if (!item || !item.dataset.id) return
  const col = state.collections.find((c) => String(c.id) === item.dataset.id)
  if (!col) return
  state.collection = col
  collList.classList.add('hidden')
  collSearch.classList.add('hidden')
  collChosen.innerHTML = `<span>${escapeHtml(col.title)}</span><span class="x">✕</span>`
  collChosen.classList.remove('hidden')
  refreshAction()
})
collChosen.addEventListener('click', (e) => {
  if (e.target.classList.contains('x')) clearCollection()
})
document.addEventListener('click', (e) => {
  if (!e.target.closest('.combo')) collList.classList.add('hidden')
})

/* ---------- 3. Mockups (filtrés par orientation) ---------- */
async function loadTemplates() {
  try {
    const r = await fetch(RENDER + '/api/templates?type=' + encodeURIComponent(state.productType))
    const data = await r.json()
    state.templates = data.categories || []
  } catch {
    state.templates = []
  }
  renderMockups() // rafraîchit la grille pour le nouveau type
}

function renderMockups() {
  const grid = $('#mockupGrid'),
    hint = $('#mockupsHint')
  grid.innerHTML = ''
  grid.classList.toggle('disabled', !!state.needsResize) // bloque les clics tant que format non conforme
  const decorBtn = $('#decorBtn')
  if (decorBtn) decorBtn.classList.toggle('hidden', !(state.orientation && !state.needsResize))
  if (!state.orientation) {
    hint.textContent = "Choisissez une image d'abord"
    return
  }

  const ori = state.orientation
  let count = 0
  for (const cat of state.templates) {
    const subs = cat.subcategories.filter((s) => s.layouts[ori]) // filtre par orientation dispo
    if (!subs.length) continue
    const head = document.createElement('div')
    head.className = 'mockup-cat'
    head.textContent = cat.name
    grid.appendChild(head)
    for (const sub of subs) {
      const L = sub.layouts[ori]
      const cell = document.createElement('div')
      cell.className = 'mockup-cell'
      const isFav = state.favPsds.has(L.psd)
      cell.innerHTML = `<button class="mc-fav${isFav ? ' on' : ''}" title="Sauvegarder ce template">${isFav ? '★' : '☆'}</button>${L.preview ? `<img src="${renderUrl(L.preview)}" loading="lazy" alt="">` : `<div class="mc-noimg"></div>`}<div class="mc-label">${escapeHtml(sub.name)}</div>`
      cell.querySelector('.mc-fav').addEventListener('click', (ev) => {
        ev.stopPropagation()
        toggleFavorite({ type: state.productType, category: cat.name, subName: sub.name, psd: L.psd, preview: L.preview || null, orientation: ori, context: sub.context || `${cat.name} - ${sub.name}` })
      })
      cell.addEventListener('click', () => generate(cat.name, sub, L, cell))
      grid.appendChild(cell)
      count++
    }
  }
  if (state.needsResize) {
    hint.textContent = "⚠️ Retaille l'image au bon format pour débloquer les mockups"
  } else {
    hint.textContent = count
      ? `${count} mockup(s) en ${labelOri(ori)}`
      : 'Aucun mockup pour cette orientation'
    if (!count)
      grid.innerHTML = `<div class="mockup-empty">Aucun mockup disponible en ${labelOri(ori)}.</div>`
  }
}
const labelOri = (o) => ({ portrait: 'portrait', landscape: 'paysage', square: 'carré' })[o] || o

/* ---------- Génération via Photopea (serveur) ---------- */
function generate(catName, sub, layout, cell) {
  return renderWithPsd({ psd: layout.psd, context: sub.context || `${catName} - ${sub.name}`, label: sub.name }, cell)
}
// Cœur du rendu Photopea, réutilisé par les mockups ET les favoris sauvegardés.
async function renderWithPsd({ psd, context, label }, cell) {
  if (!state.imageDataUrl) return toast('Choisissez une image', 'err')
  if (state.needsResize)
    return toast("Retaille d'abord l'image au bon format (3:4, carré ou 4:3)", 'err')
  cell.classList.add('busy')
  const spin = document.createElement('div')
  spin.className = 'spin'
  spin.innerHTML = '<div class="loader"></div>'
  cell.appendChild(spin)
  try {
    const r = await fetch(RENDER + '/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psd, image: state.imageDataUrl, mockupContext: context }),
    })
    const data = await r.json()
    if (!data.success) throw new Error(data.error || 'échec du rendu')
    state.results.push({
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5),
      path: data.url,
      url: renderUrl(data.url),
      context: data.mockupContext,
      label,
    })
    renderResults()
    refreshAction()
    toast('Rendu ajouté ✓', 'ok')
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  } finally {
    cell.classList.remove('busy')
    spin.remove()
  }
}

/* ---------- 3b. Templates sauvegardés (favoris Photopea + décors IA vierges) ---------- */
// Convertit une URL (image servie) en dataURL — utile pour réinjecter un décor sauvegardé
// dans l'API d'insertion (qui attend une image base64).
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

async function loadSavedTemplates() {
  try {
    const r = await fetch(RENDER + '/api/saved-templates')
    const data = await r.json()
    state.saved = { photopea: data.photopea || [], ai: data.ai || [] }
  } catch {
    state.saved = { photopea: [], ai: [] }
  }
  state.favPsds = new Set(state.saved.photopea.map((t) => t.psd))
  renderSavedTemplates()
  renderMockups() // rafraîchit l'état des étoiles
}

// Ajoute/retire un favori Photopea (toggle par chemin PSD).
async function toggleFavorite(info) {
  const existing = state.saved.photopea.find((t) => t.psd === info.psd)
  try {
    if (existing) {
      const r = await fetch(RENDER + '/api/saved-templates/photopea/' + existing.id, { method: 'DELETE' })
      if (!r.ok) throw new Error('suppression échouée')
      toast('Favori retiré', 'ok')
    } else {
      const r = await fetch(RENDER + '/api/saved-templates/photopea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: info.type, category: info.category, subName: info.subName,
          psd: info.psd, preview: info.preview,
          orientations: [info.orientation], context: info.context,
        }),
      })
      if (!r.ok) throw new Error('sauvegarde échouée')
      toast('Template sauvegardé ★', 'ok')
    }
    await loadSavedTemplates()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}

// Sauvegarde le décor IA vierge actuellement affiché (toile blanche).
async function saveAiDecor() {
  if (!lastDecor) return toast('Aucun décor à sauvegarder', 'err')
  const btn = $('#decorSave')
  btn.disabled = true
  try {
    const r = await fetch(RENDER + '/api/saved-templates/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: lastDecor.image,
        product: lastDecor.product, // métadonnées figées à la génération (pas de dérive)
        orientation: lastDecor.orientation,
        theme: lastDecor.theme,
      }),
    })
    const data = await r.json()
    if (!data.success) throw new Error(data.error || 'échec')
    toast('Décor sauvegardé ★', 'ok')
    await loadSavedTemplates()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  } finally {
    btn.disabled = false
  }
}

async function deleteSaved(kind, id) {
  try {
    const r = await fetch(RENDER + '/api/saved-templates/' + kind + '/' + id, { method: 'DELETE' })
    if (!r.ok) throw new Error('suppression échouée')
    await loadSavedTemplates()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}

// Réutilise un décor IA sauvegardé : on le recharge comme décor validé puis on ouvre l'insertion.
async function reuseSavedDecor(tpl) {
  if (!state.imageDataUrl) return toast("Choisis une image d'abord", 'err')
  if (state.needsResize) return toast("Retaille d'abord l'image au bon format", 'err')
  if (tpl.orientation && tpl.orientation !== state.orientation)
    return toast(`Ce décor est en ${labelOri(tpl.orientation)} — change d'orientation d'image`, 'err')
  try {
    state.decor = await urlToDataUrl(renderUrl(tpl.url))
    openInsertOverlay()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}

function renderSavedTemplates() {
  const ppGrid = $('#savedPhotopeaGrid'), aiGrid = $('#savedAiGrid')
  if (!ppGrid || !aiGrid) return
  const curOri = state.orientation
  // --- favoris Photopea (filtrés sur le type produit courant) ---
  const pps = state.saved.photopea.filter((t) => !t.type || t.type === state.productType)
  ppGrid.innerHTML = ''
  $('#savedPhotopeaEmpty').classList.toggle('hidden', pps.length > 0)
  for (const t of pps) {
    const ori = (t.orientations && t.orientations[0]) || null
    const compatible = !curOri || !ori || ori === curOri
    const cell = document.createElement('div')
    cell.className = 'mockup-cell saved-cell' + (compatible ? '' : ' incompatible')
    cell.innerHTML = `<button class="mc-del" title="Retirer">✕</button>${ori ? `<span class="mc-ori">${escapeHtml(labelOri(ori))}</span>` : ''}${t.preview ? `<img src="${renderUrl(t.preview)}" loading="lazy" alt="">` : `<div class="mc-noimg"></div>`}<div class="mc-label">${escapeHtml(t.subName || 'Template')}</div>`
    cell.querySelector('.mc-del').addEventListener('click', (ev) => { ev.stopPropagation(); deleteSaved('photopea', t.id) })
    cell.addEventListener('click', () => {
      if (!state.imageDataUrl) return toast('Choisis une image d\'abord', 'err')
      if (!compatible) return toast(`Ce template est en ${labelOri(ori)} — change d'orientation d'image`, 'err')
      renderWithPsd({ psd: t.psd, context: t.context || t.subName, label: t.subName || 'Template' }, cell)
    })
    ppGrid.appendChild(cell)
  }
  // --- décors IA (filtrés sur le type produit courant) ---
  const ais = state.saved.ai.filter((t) => !t.product || PRODUCT_TO_TYPE[t.product] === state.productType)
  aiGrid.innerHTML = ''
  $('#savedAiEmpty').classList.toggle('hidden', ais.length > 0)
  for (const t of ais) {
    const ori = t.orientation
    const compatible = !curOri || !ori || ori === curOri
    const cell = document.createElement('div')
    cell.className = 'mockup-cell saved-cell' + (compatible ? '' : ' incompatible')
    cell.innerHTML = `<button class="mc-del" title="Supprimer">✕</button>${ori ? `<span class="mc-ori">${escapeHtml(labelOri(ori))}</span>` : ''}<img src="${renderUrl(t.url)}" loading="lazy" alt=""><div class="mc-label">${escapeHtml(t.theme || 'Décor IA')}</div>`
    cell.querySelector('.mc-del').addEventListener('click', (ev) => { ev.stopPropagation(); deleteSaved('ai', t.id) })
    cell.addEventListener('click', () => reuseSavedDecor(t))
    aiGrid.appendChild(cell)
  }
}

/* ---------- 4. Résultats + drag-drop UNIFIÉ (pointer events : souris === tactile) ---------- */
function renderResults() {
  const grid = $('#resultsGrid'),
    empty = $('#resultsEmpty')
  grid.innerHTML = ''
  empty.classList.toggle('hidden', state.results.length > 0)
  state.results.forEach((res, i) => {
    const cell = document.createElement('div')
    cell.className = 'result-cell'
    cell.dataset.id = res.id
    cell.innerHTML = `<div class="num">${i + 1}</div><button class="del" title="Supprimer">✕</button><img src="${res.url}" alt="" draggable="false">`
    cell.querySelector('.del').addEventListener('click', (ev) => {
      ev.stopPropagation()
      removeResult(res.id)
    })
    attachDrag(cell, res)
    grid.appendChild(cell)
  })
}
function removeResult(id) {
  const res = state.results.find((r) => r.id === id)
  state.results = state.results.filter((r) => r.id !== id)
  renderResults()
  refreshAction()
  if (res) fetch(RENDER + '/api/upload/' + res.url.split('/').pop(), { method: 'DELETE' }).catch(() => {})
}
function reorder(fromId, toId) {
  if (fromId === toId) return
  const a = state.results.findIndex((r) => r.id === fromId)
  const b = state.results.findIndex((r) => r.id === toId)
  if (a < 0 || b < 0) return
  const [moved] = state.results.splice(a, 1)
  state.results.splice(b, 0, moved)
  renderResults()
}

// Un SEUL système pour souris ET tactile, via pointer events + listeners au DOCUMENT.
// Distingue clic (→ lightbox) et glissement (→ réorganisation) selon la distance parcourue.
// Pas de setPointerCapture (qui empêcherait elementFromPoint de voir les autres cellules).
let drag = null // { id, cell, res, startX, startY, moved }

function onDragMove(e) {
  if (!drag) return
  const x = e.clientX,
    y = e.clientY
  const dist = Math.abs(x - drag.startX) + Math.abs(y - drag.startY)
  if (!drag.moved && dist < 8) return
  drag.moved = true
  e.preventDefault() // empêche le scroll pendant le glissement (tactile)
  drag.cell.classList.add('dragging')
  const el = document.elementFromPoint(x, y)
  const target = el && el.closest('.result-cell')
  $$('.result-cell').forEach((c) => c.classList.toggle('over', c === target && c !== drag.cell))
}
function onDragEnd(e) {
  if (!drag) return
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
  document.removeEventListener('pointercancel', onDragEnd)
  const cur = drag
  drag = null
  $$('.result-cell').forEach((c) => c.classList.remove('over'))
  cur.cell.classList.remove('dragging')
  if (cur.moved) {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const target = el && el.closest('.result-cell')
    if (target && target.dataset.id !== cur.id) reorder(cur.id, target.dataset.id)
  } else {
    // pas de glissement = simple tap/clic -> agrandir (marche souris ET tactile,
    // y compris si le navigateur émet pointercancel au lieu de pointerup sur mobile)
    openLightbox(cur.res.url)
  }
}
function attachDrag(cell, res) {
  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return // clic gauche / tactile
    if (e.target.closest('.del')) return // pas sur supprimer
    drag = { id: cell.dataset.id, cell, res, startX: e.clientX, startY: e.clientY, moved: false }
    document.addEventListener('pointermove', onDragMove, { passive: false })
    document.addEventListener('pointerup', onDragEnd)
    document.addEventListener('pointercancel', onDragEnd)
  })
}

/* ---------- Lightbox ---------- */
const lightbox = $('#lightbox')
let lightboxOpenedAt = 0
function openLightbox(url) {
  $('#lightboxImg').src = url
  lightbox.classList.remove('hidden')
  lightboxOpenedAt = Date.now()
}
function closeLightbox() {
  lightbox.classList.add('hidden')
}
// ignore le "ghost click" tactile généré juste après l'ouverture (sinon fermeture immédiate sur mobile)
lightbox.addEventListener('click', () => {
  if (Date.now() - lightboxOpenedAt > 350) closeLightbox()
})

/* ---------- Overlay de progression (publication) ---------- */
const progress = {
  el: $('#progress'),
  show(msg) {
    $('#progressSpinner').classList.remove('hidden')
    $('#progressIcon').classList.add('hidden')
    $('#progressClose').classList.add('hidden')
    $('#progressLink').classList.add('hidden')
    $('#progressTitle').textContent = 'Publication en cours…'
    $('#progressMsg').textContent = msg || ''
    this.el.classList.remove('hidden')
  },
  step(msg) {
    $('#progressMsg').textContent = msg
  },
  done(title, link) {
    $('#progressSpinner').classList.add('hidden')
    const ic = $('#progressIcon')
    ic.className = 'progress-icon ok'
    ic.textContent = '✓'
    $('#progressTitle').textContent = title || 'Produit publié ✓'
    $('#progressMsg').textContent = ''
    if (link) {
      const a = $('#progressLink')
      a.href = link
      a.classList.remove('hidden')
    }
    $('#progressClose').classList.remove('hidden')
  },
  fail(msg) {
    $('#progressSpinner').classList.add('hidden')
    const ic = $('#progressIcon')
    ic.className = 'progress-icon err'
    ic.textContent = '✕'
    $('#progressTitle').textContent = 'Échec de la publication'
    $('#progressMsg').textContent = msg || 'Une erreur est survenue.'
    $('#progressClose').classList.remove('hidden')
  },
  hide() {
    this.el.classList.add('hidden')
  },
}
$('#progressClose').addEventListener('click', () => progress.hide())

/* ---------- Publication ---------- */
function refreshAction() {
  const info = $('#actionInfo'),
    btn = $('#publishBtn')
  const n = state.results.length
  const parts = []
  if (state.orientation) parts.push(labelOri(state.orientation))
  if (state.collection) parts.push(state.collection.title)
  parts.push(`${n} rendu${n > 1 ? 's' : ''}`)
  if (state.needsResize) {
    // bloqué tant que l'image n'est pas au bon format (3:4 / carré / 4:3)
    info.textContent = "⚠️ Retaille l'image au bon format pour publier"
    btn.disabled = true
    return
  }
  info.textContent = parts.join(' · ')
  btn.disabled = !(state.collection && n > 0 && state.imageDataUrl)
}

$('#publishBtn').addEventListener('click', async () => {
  const btn = $('#publishBtn')
  if (btn.disabled) return
  btn.disabled = true
  progress.show('Préparation des images…')
  try {
    // ordre: [mockup1, original, mockup2, ...]
    const imgs = []
    const toB64 = async (u) => {
      const resp = await fetch(u)
      if (!resp.ok) throw new Error('image introuvable (' + resp.status + ')')
      const b = await resp.blob()
      return await new Promise((r, rej) => {
        const fr = new FileReader()
        fr.onloadend = () => r(fr.result)
        fr.onerror = () => rej(new Error('lecture image échouée'))
        fr.readAsDataURL(b)
      })
    }
    for (let i = 0; i < state.results.length; i++) {
      progress.step(`Préparation des images… (${i + 1}/${state.results.length})`)
      imgs.push({
        base64Image: await toB64(state.results[i].url),
        type: 'mockup',
        mockupContext: state.results[i].context,
      })
      if (i === 0) imgs.push({ base64Image: state.imageDataUrl, type: 'original' })
    }
    const payload = {
      images: imgs,
      ratio: state.orientation,
      productType: TYPE_MAP[state.productType],
      parentCollection: { id: state.collection.id, title: state.collection.title },
    }
    progress.step('Création du produit sur Shopify… (cela peut prendre jusqu’à 1 min)')
    // timeout de sécurité (le backend peut être long : IA + Shopify)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 180000)
    let r
    try {
      r = await fetch(API + '/api/shopify-product-publisher/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
    } catch (netErr) {
      throw new Error(
        netErr.name === 'AbortError'
          ? 'Délai dépassé (le serveur met trop de temps à répondre).'
          : 'Connexion au serveur impossible.'
      )
    } finally {
      clearTimeout(timer)
    }
    const data = await r.json().catch(() => ({}))
    if (!r.ok || data.success === false) {
      const detail =
        data.message ||
        data.error ||
        (data.errors ? JSON.stringify(data.errors) : '') ||
        'Erreur serveur (HTTP ' + r.status + ')'
      throw new Error(detail)
    }
    const link = data.data && data.data.link
    progress.done('Produit publié ✓', link)
    // on retire les rendus publiés (nouvelle session propre)
    clearResults()
  } catch (e) {
    progress.fail(e.message)
  } finally {
    refreshAction()
  }
})

/* ---------- utils + init ---------- */
function escapeHtml(s) {
  return String(s || '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

;(async function init() {
  await loadTemplates()
  loadSavedTemplates()
  loadCollections()
  refreshAction()
})()
