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
// Pièce : valeur du <select #decorRoom> -> libellé FR. Sert à ranger les décors IA sauvegardés
// dans le bon groupe « pièce » de l'écran « Mes templates sauvegardés ». '' / inconnue -> « Autre ».
const ROOM_LABELS = {
  'living room': 'Salon', bedroom: 'Chambre', kitchen: 'Cuisine',
  'dining room': 'Salle à manger', 'home office': 'Bureau', entryway: 'Entrée',
  bathroom: 'Salle de bain', 'reading nook': 'Coin lecture', studio: 'Atelier',
}
const roomLabelOf = (rt) => ROOM_LABELS[rt] || 'Autre'

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
  lastBatchImage: null, // dernière œuvre pour laquelle les favoris ont été appliqués auto
  batchToken: null, // jeton du lot de favoris courant (sert à annuler un lot devenu périmé)
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
      if (dv) dv.value = '' // reset les entrées décor IA (pièce + ambiance) entre deux œuvres
      const dr = $('#decorRoom')
      if (dr) dr.value = ''
      state.decor = null
      clearResults() // nouvelle œuvre = nouvelle session de rendus
      renderMockups()
      refreshAction()
      maybeRunFavorites() // image déjà au bon format -> applique les favoris automatiquement
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
    refreshAction()
    maybeRunFavorites() // l'image est maintenant au bon format -> favoris automatiques
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
  if (!state.imageDataUrl) return toast("Ajoutez d'abord une image", 'err')
  if (state.needsResize) return toast("Retaillez d'abord l'image au bon format", 'err')
  $('#decorOverlay').classList.remove('hidden')
  $('#decorLoading').classList.add('hidden')
  $('#decorResult').classList.add('hidden')
  $('#decorActions').classList.add('hidden')
  $('#decorStartActions').classList.remove('hidden')
}
async function runDecorGenerate() {
  if (!state.imageDataUrl) return toast("Ajoutez d'abord une image", 'err')
  if (state.needsResize) return toast("Retaillez d'abord l'image au bon format", 'err')
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
    lastDecor = { image, product, theme: direction || null, orientation: state.orientation, roomType }
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
  if (!state.decor || !state.imageDataUrl) return toast('Validez d’abord un décor', 'err')
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
  if (!state.decor || !state.imageDataUrl) return toast('Validez d’abord un décor', 'err')
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
  toast('Rendu ajouté ✓', 'ok')
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
    loadTemplates() // recharge le catalogue + re-rend les décors IA du nouveau type (inclut renderMockups)
    state.lastBatchImage = null // nouveau type = nouveau jeu de favoris -> ré-application auto
    maybeRunFavorites()
  })
)

// Vide la galerie de rendus (et supprime les fichiers serveur correspondants)
function clearResults() {
  state.batchToken = {} // périme tout lot de favoris en cours -> ses écritures seront ignorées
  // seuls les rendus Photopea ont un fichier temp serveur (res.path) ; les rendus IA sont des data URI
  for (const r of state.results)
    if (r.path) fetch(RENDER + '/api/upload/' + r.path.split('/').pop(), { method: 'DELETE' }).catch(() => {})
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

// ★ favori : étoile pleine SVG (élégante), colorée via CSS, cible tappable élargie en CSS.
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.9l-5.64 2.96 1.08-6.29L2.87 9.24l6.31-.92z"/></svg>'
const favStarHtml = (on) =>
  on ? `<span class="mc-fav-badge" title="Favori — appliqué automatiquement à votre œuvre" aria-label="Favori">${STAR_SVG}</span>` : ''

// Section « Mockups » UNIFIÉE : catalogue Photopea + décors IA enregistrés, regroupés PAR PIÈCE.
// Un signe PS/IA distingue l'origine ; l'étoile marque un favori (rendu auto quand l'image est prête).
function renderMockups() {
  const grid = $('#mockupGrid'),
    hint = $('#mockupsHint')
  grid.innerHTML = ''
  grid.classList.toggle('disabled', !!state.needsResize)
  const decorBtn = $('#decorBtn')
  if (decorBtn) decorBtn.classList.toggle('hidden', !(state.orientation && !state.needsResize))
  if (!state.orientation) {
    hint.textContent = 'Ajoutez une image pour voir les mockups'
    return
  }
  const ori = state.orientation
  // entrées unifiées groupées par pièce : catalogue Photopea + décors IA sauvegardés
  const groups = {}
  const push = (room, e) => (groups[room] = groups[room] || []).push(e)
  for (const cat of state.templates) {
    for (const sub of cat.subcategories) {
      const L = sub.layouts[ori]
      if (L) push(cat.name, { kind: 'photopea', cat, sub, L })
    }
  }
  for (const t of state.saved.ai.filter((t) => !t.product || PRODUCT_TO_TYPE[t.product] === state.productType)) {
    push(roomLabelOf(t.roomType), { kind: 'ai', data: t })
  }
  const rooms = Object.keys(groups).sort((a, b) => (a === 'Autre') - (b === 'Autre') || a.localeCompare(b, 'fr'))
  let count = 0
  for (const room of rooms) {
    const head = document.createElement('div')
    head.className = 'mockup-cat'
    head.textContent = room
    grid.appendChild(head)
    for (const e of groups[room]) {
      grid.appendChild(buildMockupCell(e, ori))
      count++
    }
  }
  if (state.needsResize) {
    hint.textContent = "⚠️ Retaillez l'image au bon format pour débloquer les mockups"
  } else {
    hint.textContent = count ? `${count} mockup(s) en ${labelOri(ori)}` : `Aucun mockup en ${labelOri(ori)}`
    if (!count) grid.innerHTML = `<div class="mockup-empty">Aucun mockup disponible en ${labelOri(ori)}.</div>`
  }
}

// Vignette de la section Mockups : mockup Photopea (PS) OU décor IA enregistré (IA).
// Tap = générer / réutiliser ; appui long = menu (favori / suppression).
function buildMockupCell(e, ori) {
  const cell = document.createElement('div')
  if (e.kind === 'photopea') {
    const { cat, sub, L } = e
    const isFav = state.favPsds.has(L.psd)
    cell.className = 'mockup-cell'
    cell.innerHTML = `<span class="mc-kind pp" title="Mockup Photopea">PS</span>${favStarHtml(isFav)}${L.preview ? `<img src="${renderUrl(L.preview)}" loading="lazy" alt="">` : `<div class="mc-noimg"></div>`}<div class="mc-label">${escapeHtml(sub.name)}</div>`
    cell.addEventListener('click', () => {
      if (cell._suppressClick) { cell._suppressClick = false; return }
      generate(cat.name, sub, L, cell)
    })
    attachLongPress(cell, () => {
      const fav = state.favPsds.has(L.psd)
      const favInfo = { type: state.productType, category: cat.name, subName: sub.name, psd: L.psd, preview: L.preview || null, orientation: ori, context: sub.context || `${cat.name} - ${sub.name}` }
      return [
        { label: fav ? '★ Retirer des favoris' : '★ Ajouter aux favoris', onClick: () => toggleFavorite(favInfo) },
        { label: '🗑 Supprimer du disque', danger: true, onClick: () => deleteMockup({ psd: L.psd, preview: L.preview || null, name: sub.name }) },
      ]
    })
  } else {
    const t = e.data
    const oriT = t.orientation
    const compatible = !oriT || oriT === ori
    cell.className = 'mockup-cell saved-cell' + (compatible ? '' : ' incompatible')
    cell.title = compatible ? '' : `Décor en ${labelOri(oriT)} — changez l'orientation de l'image`
    cell.innerHTML = `<span class="mc-kind ai" title="Décor généré par IA">IA</span>${favStarHtml(!!t.favorite)}<img src="${renderUrl(t.url)}" loading="lazy" alt=""><div class="mc-label">${escapeHtml(t.theme || 'Décor IA')}</div>`
    cell.addEventListener('click', () => {
      if (cell._suppressClick) { cell._suppressClick = false; return }
      reuseSavedDecor(t)
    })
    attachLongPress(cell, () => [
      { label: t.favorite ? '★ Retirer des favoris' : '★ Ajouter aux favoris', onClick: () => toggleAiFavorite(t) },
      { label: '🗑 Supprimer', danger: true, onClick: () => deleteSaved('ai', t.id) },
    ])
  }
  return cell
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
    return toast("Retaillez d'abord l'image (3:4, carré ou 4:3)", 'err')
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
  renderMockups() // catalogue Photopea + décors IA + état des favoris
}

// Ajoute/retire un favori Photopea (toggle par chemin PSD).
async function toggleFavorite(info) {
  const existing = state.saved.photopea.find((t) => t.psd === info.psd)
  try {
    if (existing) {
      const r = await fetch(RENDER + '/api/saved-templates/photopea/' + existing.id, { method: 'DELETE' })
      if (!r.ok) throw new Error('suppression échouée')
      toast('Retiré des favoris', 'ok')
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
      toast('Favori enregistré ★', 'ok')
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
        roomType: lastDecor.roomType || null, // pièce choisie -> regroupement par pièce
      }),
    })
    const data = await r.json()
    if (!data.success) throw new Error(data.error || 'échec')
    toast('Décor enregistré ★', 'ok')
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

// Supprime un mockup du DISQUE (fichiers source sur le PC). Confirmation car c'est définitif.
// Le serveur retire l'orientation visée et, si c'était le dernier PSD, le dossier entier.
async function deleteMockup({ psd, preview, name }) {
  if (!confirm(`Supprimer définitivement le mockup « ${name} » du disque ?\nCette action est irréversible.`)) return
  try {
    const r = await fetch(RENDER + '/api/mockup', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psd, preview }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.success) throw new Error(data.error || 'suppression échouée')
    // nettoie les favoris Photopea devenus orphelins (PSD effacé) pour éviter des cellules mortes
    const folderPrefix = psd.slice(0, psd.lastIndexOf('/') + 1)
    const orphans = state.saved.photopea.filter(
      (t) => t.psd === psd || (data.folderRemoved && t.psd && t.psd.startsWith(folderPrefix))
    )
    for (const o of orphans)
      await fetch(RENDER + '/api/saved-templates/photopea/' + o.id, { method: 'DELETE' }).catch(() => {})
    toast(data.folderRemoved ? 'Mockup supprimé du disque ✓' : 'Orientation supprimée du disque ✓', 'ok')
    await loadTemplates()
    await loadSavedTemplates()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}

// Réutilise un décor IA sauvegardé : on le recharge comme décor validé puis on ouvre l'insertion.
async function reuseSavedDecor(tpl) {
  if (!state.imageDataUrl) return toast("Ajoutez d'abord une image", 'err')
  if (state.needsResize) return toast("Retaillez d'abord l'image au bon format", 'err')
  if (tpl.orientation && tpl.orientation !== state.orientation)
    return toast(`Ce décor est en ${labelOri(tpl.orientation)} — changez l'orientation de l'image`, 'err')
  try {
    state.decor = await urlToDataUrl(renderUrl(tpl.url))
    openInsertOverlay()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}

// Bascule le favori d'un décor IA (favori = inséré automatiquement, en lot, quand l'image est prête).
async function toggleAiFavorite(t) {
  try {
    const r = await fetch(RENDER + '/api/saved-templates/ai/' + t.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !t.favorite }),
    })
    if (!r.ok) throw new Error('échec')
    toast(!t.favorite ? 'Ajouté aux favoris ★' : 'Retiré des favoris', 'ok')
    await loadSavedTemplates()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}

/* ---------- Favoris automatiques ---------- */
// Dès que l'image est au bon format, on applique l'œuvre à TOUS les favoris, en un lot, une
// seule fois par œuvre : mockups Photopea favoris -> rendu ; décors IA favoris -> insertion.
function maybeRunFavorites() {
  if (!state.imageDataUrl || state.needsResize || !state.orientation) return
  if (state.lastBatchImage === state.imageDataUrl) return // déjà appliqué pour cette œuvre
  runFavoritesBatch()
}
async function runFavoritesBatch() {
  // Jeton de session : un ré-upload / changement de type bumpe state.batchToken (via clearResults
  // ou ici), ce qui PÉRIME ce lot -> ses rendus restants ne sont ni écrits ni comptés. On capture
  // aussi l'œuvre/orientation/produit UNE fois, pour ne jamais relire un state qui a changé.
  const token = (state.batchToken = {})
  const image = state.imageDataUrl,
    ori = state.orientation,
    product = productOf(state.productType),
    productType = state.productType
  const ppFavs = state.saved.photopea.filter(
    (t) => (!t.type || t.type === productType) && (!(t.orientations && t.orientations[0]) || t.orientations[0] === ori)
  )
  const aiFavs = state.saved.ai.filter(
    (t) => t.favorite && (!t.product || PRODUCT_TO_TYPE[t.product] === productType) && (!t.orientation || t.orientation === ori)
  )
  const total = ppFavs.length + aiFavs.length
  if (!total) return
  state.lastBatchImage = image
  const hint = $('#mockupsHint')
  let done = 0,
    fails = 0
  const stale = () => token !== state.batchToken
  const tick = () => { if (hint && !stale()) hint.textContent = `Application de vos favoris… ${done}/${total}` }
  const addResult = (res) => {
    if (stale()) return false // lot périmé -> on n'écrit pas dans la session courante
    state.results.push(res)
    renderResults()
    refreshAction()
    return true
  }
  tick()
  for (const pp of ppFavs) {
    try {
      const res = await renderFavoritePhotopea(pp, image)
      if (!addResult(res)) return
    } catch { fails++ }
    if (stale()) return
    done++
    tick()
  }
  for (const ai of aiFavs) {
    try {
      const res = await insertFavoriteAi(ai, image, ori, product)
      if (!addResult(res)) return
    } catch { fails++ }
    if (stale()) return
    done++
    tick()
  }
  renderMockups() // restaure le hint normal
  toast(
    fails ? `${total - fails}/${total} favori(s) appliqué(s) · ${fails} échec(s)` : `${total} favori(s) appliqué(s) ✓`,
    fails ? 'err' : 'ok'
  )
}
// Génèrent/insèrent SANS toucher à state.results : c'est le lot qui décide d'écrire (selon le jeton).
async function renderFavoritePhotopea(pp, image) {
  const r = await fetch(RENDER + '/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ psd: pp.psd, image, mockupContext: pp.context || pp.subName }),
  })
  const data = await r.json()
  if (!data.success) throw new Error(data.error || 'échec du rendu')
  return {
    id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5),
    path: data.url, url: renderUrl(data.url), context: data.mockupContext, label: pp.subName || 'Mockup',
  }
}
async function insertFavoriteAi(ai, image, ori, product) {
  const decor = await urlToDataUrl(renderUrl(ai.url))
  const img = await callInsertJob({ decor, artwork: image, target: ori, product, fidelity: 'standard' })
  return {
    id: 'ins' + Date.now() + Math.random().toString(36).slice(2, 5),
    path: null, url: img, context: 'Décor sur-mesure (IA)', label: 'Décor IA',
  }
}

/* ---------- 4. Résultats + drag-drop UNIFIÉ (pointer events : souris === tactile) ---------- */
function renderResults() {
  // Si un glisser est en cours quand on reconstruit la grille (ex. un rendu asynchrone qui se
  // termine), on l'annule proprement AVANT le innerHTML='' — sinon proxy/placeholder se retrouvent
  // détachés (finishDrop planterait, page potentiellement bloquée non-scrollable). drag déjà nul
  // sur les chemins normaux (dépose/annulation) -> no-op.
  if (drag) teardownDrag()
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
  if (res && res.path) fetch(RENDER + '/api/upload/' + res.path.split('/').pop(), { method: 'DELETE' }).catch(() => {})
}
// Réorganisation par APPUI LONG puis glisser — refonte « follow finger + push apart ».
//
// Bug historique : .result-cell avait touch-action:pan-y, ce qui AUTORISE le navigateur à
// s'emparer d'un glisser vertical pour scroller la page (il émet alors un pointercancel qui coupe
// le drag en plein vol). e.preventDefault() sur pointermove n'y peut RIEN : un pan déjà pris par le
// compositeur ne se rend pas. On corrige en PRENANT la main une fois armé : setPointerCapture + un
// listener touchmove NON-PASSIF (posé une fois sur la grille, donc présent dès le touchstart — seule
// façon de bloquer un pan tactile) qui preventDefault tant qu'on glisse + touch-action:none sur les
// cellules. Avant l'armement on garde pan-y pour que la longue liste scrolle nativement.
//
// UX : la cellule est SORTIE du flux (position:fixed) et suit le doigt ; un placeholder garde sa
// place ; les voisines se poussent en fluide via FLIP ; auto-scroll quand le doigt frôle un bord.
const ARM_MS = 350, MOVE_SLOP = 10, EDGE = 72, MAX_V = 18
let drag = null

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return // multi-touch : on ignore les autres doigts
  drag.lastX = e.clientX
  drag.lastY = e.clientY
  if (!drag.armed) {
    // pas encore armé : un déplacement = intention de scroll/tap -> on abandonne (pan-y scrolle)
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > MOVE_SLOP) cancelDrag()
    return
  }
  e.preventDefault() // armé : on prend la main (le touchmove non-passif bloque déjà le scroll natif)
  drag.moved = true
  moveProxy(e.clientX, e.clientY)
  computeScrollDir(e.clientY)
  updateHover(e.clientX, e.clientY)
}

// Arme le glisser après l'appui long : on « soulève » la VRAIE cellule (pas un clone — les rendus
// sont des data-URL base64 lourds à re-décoder) et on laisse un placeholder à sa place.
function armDrag() {
  if (!drag.cell.isConnected) { teardownDrag(); return } // cellule détachée entre-temps -> on abandonne
  const c = drag.cell, r = c.getBoundingClientRect()
  drag.armed = true
  drag.w = r.width
  drag.h = r.height
  drag.grabX = drag.lastX - r.left // offset du doigt DANS la cellule (mesuré à l'armement)
  drag.grabY = drag.lastY - r.top
  const grid = c.parentElement
  grid.style.minHeight = grid.offsetHeight + 'px' // verrouille la hauteur le temps du glisser : le conteneur ne peut plus rétrécir -> pas de saut de scroll
  grid.classList.add('reordering') // -> touch-action:none sur les cellules + couche GPU
  try { c.setPointerCapture(drag.pointerId); drag.captured = true } catch (_) {}
  const ph = document.createElement('div')
  ph.className = 'result-cell placeholder'
  // taille EXPLICITE (px) = celle de la cellule soulevée. SURTOUT PAS aspect-ratio sur un élément vide :
  // WebKit/mobile le résout de façon instable sous les reflows du FLIP (le trou seul dans sa rangée
  // s'effondre 1 frame puis regrossit -> la hauteur du conteneur oscille -> saut de scroll). En px, tous d'accord.
  ph.style.width = drag.w + 'px'
  ph.style.height = drag.h + 'px'
  grid.insertBefore(ph, c)
  drag.placeholder = ph
  c.style.width = drag.w + 'px'
  c.style.height = drag.h + 'px'
  c.classList.add('dragging', 'drag-armed')
  moveProxy(drag.lastX, drag.lastY)
  if (navigator.vibrate) navigator.vibrate(15) // retour haptique
  startAutoScroll()
}

function moveProxy(px, py) {
  drag.cell.style.transform = 'translate(' + (px - drag.grabX) + 'px,' + (py - drag.grabY) + 'px) scale(1.04)'
}

// Place le « trou » (placeholder) dans le DOM en fonction de la position du doigt, recalculée DE ZÉRO
// à chaque mouvement (pas d'elementFromPoint : instable au niveau des frontières à cause du reflow).
// On balaie les cellules en ORDRE DE LECTURE (haut->bas, gauche->droite) et on insère le trou avant la
// 1re cellule « après » le doigt -> stable sous reflux, gère nativement la grille 2D (2 colonnes mobile).
// Le FLIP (coûteux) ne tourne QUE si la position du trou change vraiment -> précis et sans thrash.
function updateHover(px, py) {
  const grid = drag.placeholder.parentElement
  const cells = [...grid.children].filter((c) => c !== drag.cell && c !== drag.placeholder)
  const first = new Map(cells.map((c) => [c, c.getBoundingClientRect()])) // 1 passe de rects (réutilisée FIRST)
  let ref = null // noeud devant lequel insérer le trou ; null = en fin de liste
  for (const c of cells) {
    const r = first.get(c)
    // le doigt est AVANT c si dans une rangée au-dessus, ou même rangée et à gauche du centre de c
    if (py < r.top || (py <= r.bottom && px < r.left + r.width / 2)) { ref = c; break }
  }
  if (drag.placeholder.nextSibling === ref) return // le trou est déjà à cette place -> aucun FLIP
  grid.insertBefore(drag.placeholder, ref)
  for (const c of cells) { // LAST + INVERT (réutilise les rects FIRST)
    const a = first.get(c), b = c.getBoundingClientRect()
    const dx = a.left - b.left, dy = a.top - b.top
    if (dx || dy) { c.style.transition = 'none'; c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)' }
  }
  requestAnimationFrame(() => { // PLAY : on relâche -> la transition CSS ramène à 0 en fluide
    for (const c of cells) { c.style.transition = ''; c.style.transform = '' }
  })
}

// Auto-scroll : tant que le doigt est dans la bande haute/basse de l'écran, on fait défiler la page
// (rAF) et on re-teste ce qui passe sous le doigt immobile -> on atteint des slots hors écran.
function computeScrollDir(y) {
  const vh = window.innerHeight
  if (y < EDGE) drag.scrollDir = -(1 - y / EDGE)
  else if (y > vh - EDGE) drag.scrollDir = 1 - (vh - y) / EDGE
  else drag.scrollDir = 0
}
function startAutoScroll() {
  const tick = () => {
    if (!drag || !drag.armed) return
    if (drag.scrollDir) {
      window.scrollBy(0, drag.scrollDir * MAX_V)
      moveProxy(drag.lastX, drag.lastY) // position:fixed -> on garde le proxy collé au doigt
      updateHover(drag.lastX, drag.lastY) // un nouveau contenu défile sous le doigt
    }
    drag.raf = requestAnimationFrame(tick)
  }
  drag.raf = requestAnimationFrame(tick)
}

function endDrag(e) {
  if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return
  if (drag.armed) { finishDrop(); return } // dépose (avec ou sans déplacement)
  const cur = drag
  teardownDrag()
  openLightbox(cur.res.url) // tap simple (pas d'appui long) -> agrandir
}

// Dépose : on fige le nouvel ordre IMMÉDIATEMENT (pas de commit différé — sinon un callback en
// retard d'une dépose précédente viendrait perturber un glisser suivant), PUIS on anime l'atterrissage
// en FLIP sur la vraie cellule fraîchement rendue (de la position du doigt jusqu'à son slot).
// L'ordre est lu depuis le DOM, le placeholder tenant la place de l'oeuvre glissée — exact pour
// toutes les positions (fin de liste comprise).
function finishDrop() {
  const cur = drag
  drag = null
  if (cur.timer) clearTimeout(cur.timer)
  if (cur.raf) cancelAnimationFrame(cur.raf)
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', endDrag)
  document.removeEventListener('pointercancel', cancelDrag)
  try { if (cur.captured) cur.cell.releasePointerCapture(cur.pointerId) } catch (_) {}
  const grid = cur.placeholder.parentElement
  const from = cur.cell.getBoundingClientRect() // où le doigt a lâché la cellule flottante
  const order = [...grid.children]
    .map((n) => (n === cur.placeholder ? cur.id : n === cur.cell ? null : n.dataset.id))
    .filter(Boolean)
  state.results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  grid.classList.remove('reordering')
  grid.style.minHeight = '' // déverrouille la hauteur avant la reconstruction (hauteur naturelle)
  renderResults() // reconstruit dans le nouvel ordre (détruit le proxy + le placeholder, renumérote)
  // FLIP d'atterrissage : la nouvelle cellule part visuellement de la position du doigt et glisse
  // jusqu'à son slot via la transition CSS de base. Aucun timer différé -> aucune course possible.
  const fresh = [...grid.children].find((c) => c.dataset && c.dataset.id === cur.id)
  if (fresh) {
    const to = fresh.getBoundingClientRect()
    fresh.style.transition = 'none'
    fresh.style.transform = 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(1.04)'
    requestAnimationFrame(() => { fresh.style.transition = ''; fresh.style.transform = '' })
  }
}

function cancelDrag() {
  if (!drag) return
  const armed = drag.armed
  teardownDrag()
  if (armed) renderResults() // resynchronise les voisines à demi-FLIP après un pointercancel
}
function teardownDrag() {
  if (!drag) return
  const cur = drag
  drag = null
  if (cur.timer) clearTimeout(cur.timer)
  if (cur.raf) cancelAnimationFrame(cur.raf)
  const c = cur.cell
  c.classList.remove('dragging', 'drag-armed')
  c.style.transform = c.style.width = c.style.height = c.style.transition = ''
  try { if (cur.captured) c.releasePointerCapture(cur.pointerId) } catch (_) {}
  if (cur.placeholder) cur.placeholder.remove()
  const grid = $('#resultsGrid')
  if (grid) { grid.classList.remove('reordering'); grid.style.minHeight = '' }
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', endDrag)
  document.removeEventListener('pointercancel', cancelDrag)
}
function attachDrag(cell, res) {
  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return // clic gauche / tactile uniquement
    if (e.target.closest('.del')) return // pas sur le bouton supprimer
    if (drag) return // un glisser est déjà en cours (2e doigt) -> on ne l'interrompt pas
    drag = {
      id: cell.dataset.id, cell, res, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      armed: false, moved: false, captured: false, placeholder: null,
      w: 0, h: 0, grabX: 0, grabY: 0, scrollDir: 0, raf: 0, timer: null,
    }
    drag.timer = setTimeout(() => { if (drag) armDrag() }, ARM_MS)
    document.addEventListener('pointermove', onDragMove, { passive: false })
    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', cancelDrag)
  })
  cell.addEventListener('dragstart', (e) => e.preventDefault()) // pas de drag natif HTML5 (desktop)
}

// Garde-fou anti-scroll : UN SEUL listener touchmove NON-PASSIF, posé une fois sur la grille (donc
// présent dès le touchstart, condition sine qua non pour bloquer un pan tactile). Tant que le glisser
// n'est pas armé il ne fait RIEN -> la liste scrolle normalement.
;(function initTouchGuard() {
  const grid = $('#resultsGrid')
  if (!grid) return
  grid.addEventListener('touchmove', (e) => { if (drag && drag.armed) e.preventDefault() }, { passive: false })
})()

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

/* ---------- Menu contextuel (appui long mobile + clic droit desktop) ---------- */
// Un seul menu flottant réutilisé pour mockups ET templates sauvegardés. Les actions
// risquées (favori, suppression) ne sont plus des boutons « toujours visibles » : on les
// atteint par un geste volontaire (appui long ~500ms) -> plus de clic par inadvertance.
const ctxMenu = $('#ctxMenu')
let ctxOpen = false, ctxArmed = false
// On ferme le menu dès qu'une NOUVELLE interaction démarre hors du menu — en écoutant le
// pointerdown, PAS le click. Le "ghost click" tactile qui suit l'appui long n'est pas un
// pointerdown : il ne peut donc pas refermer le menu juste après son ouverture (le pointerdown
// d'ouverture, lui, est déjà passé avant que le menu n'apparaisse). Robuste, sans garde temporel.
// On en profite pour ARMER le menu : ses items ne deviennent cliquables qu'après ce 1er pointerdown
// post-ouverture. Ainsi, si le menu s'ouvre SOUS le doigt, le clic fantôme du relâchement (non précédé
// d'un nouveau pointerdown) ne sélectionne PAS le 1er item par inadvertance.
function onCtxOutsidePointer(e) {
  ctxArmed = true
  if (e.target.closest('#ctxMenu')) return
  closeContextMenu()
}
function closeContextMenu() {
  document.removeEventListener('pointerdown', onCtxOutsidePointer, true)
  document.removeEventListener('scroll', closeContextMenu, true)
  window.removeEventListener('resize', closeContextMenu)
  if (!ctxOpen) return
  ctxMenu.classList.add('hidden')
  ctxMenu.innerHTML = ''
  ctxOpen = false
}
function openContextMenu(x, y, items) {
  if (!ctxMenu || !items || !items.length) return
  closeContextMenu() // repart propre (retire d'éventuels listeners d'un menu précédent)
  ctxMenu.innerHTML = ''
  for (const it of items) {
    const b = document.createElement('button')
    b.className = 'ctx-item' + (it.danger ? ' danger' : '')
    b.textContent = it.label
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (!ctxArmed) return; closeContextMenu(); it.onClick() })
    ctxMenu.appendChild(b)
  }
  ctxMenu.classList.remove('hidden')
  ctxOpen = true
  ctxArmed = false // armé seulement au 1er pointerdown post-ouverture (cf. onCtxOutsidePointer)
  // positionnement clampé au viewport (mesuré après affichage)
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight
  ctxMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + 'px'
  ctxMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + 'px'
  // listeners de fermeture armés SEULEMENT une fois le menu ouvert (l'ouverture ne génère ni
  // scroll ni resize : pas d'auto-fermeture). Ils sont retirés dans closeContextMenu().
  document.addEventListener('pointerdown', onCtxOutsidePointer, true)
  document.addEventListener('scroll', closeContextMenu, true)
  window.addEventListener('resize', closeContextMenu)
}

// Attache la détection d'appui long (tactile/souris) + clic droit à une cellule.
// getItems() est appelé À L'OUVERTURE (état frais : favori ou non, etc.).
function attachLongPress(cell, getItems) {
  let timer = null, sx = 0, sy = 0
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null } }
  cell.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return // clic droit -> géré par 'contextmenu'
    cell._suppressClick = false
    sx = e.clientX; sy = e.clientY
    cancel()
    timer = setTimeout(() => {
      timer = null
      cell._suppressClick = true // neutralise le clic qui suit le relâchement
      openContextMenu(sx, sy, getItems())
    }, 500)
  })
  cell.addEventListener('pointermove', (e) => {
    if (timer && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) cancel() // scroll/glissement -> annule
  })
  cell.addEventListener('pointerup', cancel)
  cell.addEventListener('pointercancel', cancel)
  cell.addEventListener('pointerleave', cancel)
  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    cell._suppressClick = true
    openContextMenu(e.clientX, e.clientY, getItems())
  })
}

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
