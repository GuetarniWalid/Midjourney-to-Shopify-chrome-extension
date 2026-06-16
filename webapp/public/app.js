/* ===== MyselfMonArt Publisher — logique front (mobile + desktop) ===== */
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]

/* Config injectable par l'hôte (le backend met window.PUBLISHER_CONFIG dans la page).
   - RENDER : moteur de rendu sur le PC (templates, render, fichiers). Via tunnel en prod.
   - API    : backend MyselfMonArt (collections, publish). Vide = même origine que la page. */
const CFG = window.PUBLISHER_CONFIG || {}
const RENDER = (CFG.renderBase || '').replace(/\/$/, '') // ex: https://xxx.trycloudflare.com ; '' = même origine (test local)
const API = (CFG.apiBase || '').replace(/\/$/, '') // ex: '' (backend sert la page) ou http://localhost:3333
// Mode de l'app : 'create' (publication classique) ou 'reimage' (refaire les images d'un produit
// existant). Injecté par le backend en prod, ou via ?mode=reimage en dev (render server PC).
const MODE = CFG.mode || new URLSearchParams(location.search).get('mode') || 'create'
const IS_REIMAGE = MODE === 'reimage'
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

/* ---------- Sections personnalisées (ré-étiquetage NON destructif des mockups) ----------
   On range un mockup dans une autre section sans toucher au disque : un PSD reçoit une étiquette
   keyée par son sous-dossier (suit toutes les orientations) ; un décor IA reçoit un champ `section`.
   Le libellé prime sur le défaut (dossier disque pour un PSD, pièce/« Autre » pour un décor IA). */
// Sentence-case : 1re lettre en majuscule, le reste tel quel (colle aux libellés ROOM_LABELS,
// ex. « Salle à manger »). Espaces multiples compactés.
function normalizeSection(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}
// Fusion insensible à la casse : si le nom saisi correspond (casse ignorée) à une section déjà
// présente, on réutilise SON libellé exact (pas de doublon « Chambre » / « chambre »).
function resolveSection(raw, existing) {
  const norm = normalizeSection(raw)
  if (!norm) return ''
  const low = norm.toLocaleLowerCase('fr')
  return (existing || []).find((e) => e.toLocaleLowerCase('fr') === low) || norm
}
// Sous-dossier d'un PSD = clé d'étiquette stable (commune aux orientations) : .../sous-cat/file.psd -> .../sous-cat
const subfolderOf = (psdUrl) => String(psdUrl || '').slice(0, String(psdUrl || '').lastIndexOf('/'))
// Section affichée d'un PSD : override si présent, sinon son dossier catégorie (défaut disque).
const sectionForPsd = (psdUrl, fallback) => state.sectionOverrides[subfolderOf(psdUrl)] || fallback

const state = {
  imageDataUrl: null, // l'oeuvre uploadée (dataURL)
  orientation: null, // 'portrait' | 'landscape' | 'square'
  productType: 'toile',
  collections: [],
  collection: null, // {id, title}
  templates: [], // catégories scannées
  // [{id, url, context, label, psd?|decor?+fidelity?, pp?:{url,path,busy,error,optedOut}}]
  // psd/decor : paramètres de rendu retenus pour re-générer le JUMEAU passe-partout (poster).
  results: [],
  mattedOeuvre: null, // œuvre avec passe-partout (dataURL), cache
  mattedOeuvreSrc: null, // source ayant servi au cache ci-dessus (invalidation si l'œuvre change)
  saved: { photopea: [], ai: [] }, // templates sauvegardés "pour toujours"
  sectionOverrides: {}, // { "<sous-dossier PSD>": "<Libellé>" } — ré-étiquetage des mockups PSD
  favPsds: new Set(), // chemins PSD favoris (pour l'état des étoiles)
  lastBatchImage: null, // dernière œuvre pour laquelle les favoris ont été appliqués auto
  batchToken: null, // jeton du lot de favoris courant (sert à annuler un lot devenu périmé)
  product: null, // mode reimage : contexte du produit choisi {id, title, orientation, productType, images, hasVideo}
  // mode reimage v2 : l'œuvre est FIGÉE (toujours l'image n°2 du produit, l'image par défaut).
  // Elle n'est jamais ré-uploadée : à la publication elle est référencée par son mediaId.
  oeuvre: null, // {mediaId, url (pleine résolution), alt} | null
  initialFp: null, // empreinte de la galerie au chargement du produit (détection « modifié »)
  publishFp: null, // empreinte au moment où la clé d'idempotence a été créée (rotation si contenu changé)
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
  // reimage v2 : l'œuvre est figée (image n°2 du produit) — aucun upload possible.
  // Changer d'œuvre = nouveau produit = l'app de création.
  if (IS_REIMAGE) return toast("L'œuvre est figée en mode reimage — utilisez l'app de création pour une nouvelle œuvre", 'err')
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
      clearCollection() // nouvelle œuvre = on oublie la collection choisie (sinon risque de publier dans la mauvaise)
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
  // mode reimage : l'orientation du produit est IMPOSÉE — l'image devra s'y conformer (retaillage)
  if (IS_REIMAGE && state.product && state.product.orientation) {
    const locked = state.product.orientation
    if (ori !== locked)
      toast(`L'image semble ${labelOri(ori)}, le produit est ${labelOri(locked)} — le retaillage convertira au bon format.`)
    ori = locked
    label = { portrait: 'Portrait', landscape: 'Paysage', square: 'Carré' }[locked]
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
// fetch + parse JSON sous UN SEUL timeout : borne l'attente des en-têtes ET du corps de la
// réponse. Sans ça, un START (ou un poll) dont la connexion stalle — réponse jamais reçue, ou
// en-têtes reçus mais corps qui n'arrive jamais — laissait le spinner tourner à l'infini (les
// boucles de polling ne sont bornées que si chaque fetch finit par résoudre ou rejeter).
// En cas de dépassement, abort -> le fetch/json lève AbortError (à traiter par l'appelant).
async function fetchJsonT(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    const data = await safeJson(res)
    return { res, data }
  } finally {
    clearTimeout(timer)
  }
}
// Redimensionnement ASYNCHRONE : on démarre un job (réponse immédiate) puis on
// interroge son état en boucle. Chaque requête est courte -> jamais de 524 Cloudflare,
// quelle que soit la durée réelle de gpt-image-2.
// quality 'low'|'high' ; sourceImage = image à envoyer (défaut = l'originale uploadée) ;
// mode 'recompose' (recomposer l'original pour remplir le cadre) ou 'enhance' (re-rendu FIDÈLE
// de l'aperçu LOW déjà validé -> le HIGH est exactement le LOW validé, pas une nouvelle image).
async function callResize(quality, sourceImage, mode) {
  let startRes, startData
  try {
    ;({ res: startRes, data: startData } = await fetchJsonT(
      API + '/api/resize-artwork',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: sourceImage || state.imageDataUrl,
          target: state.orientation,
          quality,
          mode: mode || 'recompose',
        }),
      },
      90000
    ))
  } catch (e) {
    throw new Error(
      e.name === 'AbortError'
        ? 'Le service met trop de temps à démarrer. Réessaye.'
        : 'Connexion au serveur impossible.'
    )
  }
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
      ;({ res, data } = await fetchJsonT(
        API + '/api/resize-artwork/result?id=' + encodeURIComponent(jobId),
        {},
        20000
      ))
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
  showResizeLoading('Génération de l\'aperçu… (~10-20s)')
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
  showResizeLoading('Génération en haute qualité… (~20-40s)')
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
  let startRes, startData
  try {
    ;({ res: startRes, data: startData } = await fetchJsonT(
      API + '/api/generate-decor',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      90000
    ))
  } catch (e) {
    throw new Error(
      e.name === 'AbortError'
        ? 'Le service met trop de temps à démarrer. Réessaye.'
        : 'Connexion au serveur impossible.'
    )
  }
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
      ;({ res, data } = await fetchJsonT(
        API + '/api/generate-decor/result?id=' + encodeURIComponent(jobId),
        {},
        20000
      ))
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
  if (!state.imageDataUrl)
    return toast(
      IS_REIMAGE ? "L'œuvre n'est pas encore chargée — réessayez dans un instant" : "Ajoutez d'abord une image",
      'err'
    )
  if (state.needsResize) return toast("Retaillez d'abord l'image au bon format", 'err')
  $('#decorOverlay').classList.remove('hidden')
  $('#decorLoading').classList.add('hidden')
  $('#decorResult').classList.add('hidden')
  $('#decorActions').classList.add('hidden')
  $('#decorStartActions').classList.remove('hidden')
}
async function runDecorGenerate() {
  if (!state.imageDataUrl)
    return toast(
      IS_REIMAGE ? "L'œuvre n'est pas encore chargée — réessayez dans un instant" : "Ajoutez d'abord une image",
      'err'
    )
  if (state.needsResize) return toast("Retaillez d'abord l'image au bon format", 'err')
  showDecorLoading('Génération du décor sur-mesure… (~15-30s)')
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
let lastInsertMeta = null // {decor, fidelity} du dernier rendu -> retenu pour le jumeau passe-partout
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
  let startRes, startData
  try {
    ;({ res: startRes, data: startData } = await fetchJsonT(
      API + '/api/insert-artwork',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      90000
    ))
  } catch (e) {
    throw new Error(
      e.name === 'AbortError'
        ? 'Le service met trop de temps à démarrer. Réessaye.'
        : 'Connexion au serveur impossible.'
    )
  }
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
      ;({ res, data } = await fetchJsonT(
        API + '/api/insert-artwork/result?id=' + encodeURIComponent(jobId),
        {},
        20000
      ))
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
  showInsertLoading('Insertion de votre œuvre dans le décor… (~20-40s)')
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
    lastInsertMeta = { decor: state.decor, fidelity } // pour re-générer le jumeau passe-partout
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
  const res = {
    id: 'ins' + Date.now() + Math.random().toString(36).slice(2, 5),
    path: null,
    url: lastInsert,
    context: 'Décor sur-mesure (IA)',
    label: 'Décor IA',
    decor: lastInsertMeta && lastInsertMeta.decor, // retenus pour re-générer le jumeau passe-partout
    fidelity: lastInsertMeta && lastInsertMeta.fidelity,
  }
  state.results.push(res)
  renderResults()
  refreshAction()
  queueTwin(res)
  $('#insertOverlay').classList.add('hidden')
  lastInsert = null
  toast('Rendu ajouté ✓', 'ok')
})

/* ---------- 3c. Ajouter un mockup (photo importée, nettoyée par IA) ---------- */
// Une photo de mise en situation (même avec textes/logos superposés ou une œuvre déjà dans le
// cadre) part au backend qui retire les marquages, vide le support en gris #ECECEC, le convertit
// au type produit ACTIF et le met au ratio de l'œuvre EN COURS. Le résultat est un décor comme
// les autres : utilisable tout de suite (insertion) et/ou enregistrable dans les templates.
let cleanSrc = null // photo importée (dataURL) en attente de nettoyage
let lastClean = null // dernier mockup nettoyé : { image, product, orientation } | null
function showCleanLoading(msg) {
  $('#cleanLoading').classList.remove('hidden')
  $('#cleanLoadingMsg').textContent = msg
  $('#cleanResult').classList.add('hidden')
  $('#cleanSrcWrap').classList.add('hidden')
  $('#cleanActions').classList.add('hidden')
  $('#cleanStartActions').classList.add('hidden')
}
async function callCleanJob(body) {
  let startRes, startData
  try {
    ;({ res: startRes, data: startData } = await fetchJsonT(
      API + '/api/clean-mockup',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      90000
    ))
  } catch (e) {
    throw new Error(
      e.name === 'AbortError'
        ? 'Le service met trop de temps à démarrer. Réessaye.'
        : 'Connexion au serveur impossible.'
    )
  }
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Impossible de démarrer (' + startRes.status + ')')
  }
  const startedAt = Date.now()
  const MAX_MS = 11 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error('Le nettoyage du mockup a expiré. Réessaye.')
    await sleep(3000)
    let res, data
    try {
      ;({ res, data } = await fetchJsonT(
        API + '/api/clean-mockup/result?id=' + encodeURIComponent(jobId),
        {},
        20000
      ))
    } catch (e) {
      if (++netErrors > 6) throw new Error('Connexion interrompue pendant le nettoyage.')
      continue
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found') throw new Error('Session expirée. Relance.')
    if (data.status === 'error') throw new Error(data.message || 'Échec du nettoyage du mockup.')
    if (data.status === 'done' && data.data && data.data.image) return data.data.image
  }
}
function openCleanOverlay() {
  if (!state.imageDataUrl) return toast("Ajoutez d'abord une image", 'err')
  if (state.needsResize) return toast("Retaillez d'abord l'image au bon format", 'err')
  cleanSrc = null
  lastClean = null
  $('#cleanFile').value = ''
  $('#cleanOverlay').classList.remove('hidden')
  $('#cleanLoading').classList.add('hidden')
  $('#cleanResult').classList.add('hidden')
  $('#cleanSrcWrap').classList.add('hidden')
  $('#cleanActions').classList.add('hidden')
  $('#cleanStartActions').classList.remove('hidden')
  $('#cleanGenerate').disabled = true
}
$('#cleanFile').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  if (!f.type.startsWith('image/')) return toast('Fichier non image', 'err')
  const reader = new FileReader()
  reader.onload = () => {
    cleanSrc = reader.result
    $('#cleanSrcImg').src = cleanSrc
    $('#cleanSrcWrap').classList.remove('hidden')
    $('#cleanResult').classList.add('hidden')
    $('#cleanActions').classList.add('hidden')
    $('#cleanStartActions').classList.remove('hidden')
    $('#cleanGenerate').disabled = false
  }
  reader.readAsDataURL(f)
})
async function runCleanGenerate() {
  if (!cleanSrc) return toast('Choisissez d’abord une photo de mockup', 'err')
  showCleanLoading('Nettoyage du mockup… (~20-30s)')
  try {
    const product = productOf(state.productType)
    const image = await callCleanJob({ image: cleanSrc, target: state.orientation, product })
    // Métadonnées figées AU MOMENT du nettoyage (pas de dérive si on change de type ensuite).
    lastClean = { image, product, orientation: state.orientation }
    $('#cleanImg').src = image
    fillCleanSectionSelect() // choix de la section dès l'enregistrement (sinon « Autre » par défaut)
    $('#cleanLoading').classList.add('hidden')
    $('#cleanResult').classList.remove('hidden')
    $('#cleanActions').classList.remove('hidden')
  } catch (e) {
    $('#cleanLoading').classList.add('hidden')
    $('#cleanSrcWrap').classList.remove('hidden')
    $('#cleanStartActions').classList.remove('hidden')
    toast('Mockup : ' + e.message, 'err')
  }
}
// Remplit le sélecteur de section de l'overlay de nettoyage : « Autre » (défaut = aucune étiquette),
// les sections présentes dans la grille, puis « ＋ Nouvelle section… » (révèle un champ texte).
function fillCleanSectionSelect() {
  const sel = $('#cleanSection')
  if (!sel) return
  const labels = ['Autre', ...gridSectionLabels().filter((l) => l !== 'Autre')]
  sel.innerHTML =
    labels.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('') +
    '<option value="__new__">＋ Nouvelle section…</option>'
  sel.value = 'Autre'
  $('#cleanSectionNew').classList.add('hidden')
  $('#cleanSectionNew').value = ''
}
// Section choisie au nettoyage : « Autre » -> null (pas d'étiquette) ; « __new__ » -> champ normalisé+fusionné.
function cleanChosenSection() {
  const sel = $('#cleanSection')
  if (!sel) return null
  if (sel.value === '__new__') return resolveSection($('#cleanSectionNew').value, gridSectionLabels()) || null
  return sel.value && sel.value !== 'Autre' ? sel.value : null
}

// Enregistre le mockup nettoyé dans les templates — même rayon que les décors IA (l'origine
// n'est qu'une métadonnée interne, aucun badge en galerie).
async function saveCleanedMockup() {
  if (!lastClean) return toast('Aucun mockup à enregistrer', 'err')
  const btn = $('#cleanSave')
  btn.disabled = true
  try {
    const r = await fetch(RENDER + '/api/saved-templates/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: lastClean.image,
        product: lastClean.product,
        orientation: lastClean.orientation,
        theme: 'Mockup importé',
        roomType: null,
        section: cleanChosenSection(),
        origin: 'upload',
      }),
    })
    const data = await r.json()
    if (!data.success) throw new Error(data.error || 'échec')
    toast('Mockup enregistré ★', 'ok')
    await loadSavedTemplates()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  } finally {
    btn.disabled = false
  }
}
$('#mockupUploadBtn').addEventListener('click', openCleanOverlay)
$('#cleanGenerate').addEventListener('click', runCleanGenerate)
$('#cleanRegen').addEventListener('click', runCleanGenerate)
$('#cleanSave').addEventListener('click', saveCleanedMockup)
$('#cleanSection').addEventListener('change', () => {
  $('#cleanSectionNew').classList.toggle('hidden', $('#cleanSection').value !== '__new__')
})
$('#cleanCancel').addEventListener('click', () => {
  $('#cleanOverlay').classList.add('hidden')
  cleanSrc = null
  lastClean = null
})
$('#cleanClose').addEventListener('click', () => {
  $('#cleanOverlay').classList.add('hidden')
})
// Utiliser tout de suite : le mockup nettoyé devient le décor validé -> insertion immédiate.
$('#cleanValidate').addEventListener('click', () => {
  if (!lastClean) return
  state.decor = lastClean.image
  $('#cleanOverlay').classList.add('hidden')
  openInsertOverlay()
})

/* ---------- 2. Type produit + collections ---------- */
$$('#productType .seg-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (state.productType === btn.dataset.type) return
    // changer de type = autres collections ET autres rendus -> on réinitialise les rendus
    // générés. En reimage, les vignettes CONSERVÉES du produit restent (seuls les rendus
    // générés avec l'ancien type sautent).
    const generated = IS_REIMAGE ? state.results.filter((r) => !r.kept) : state.results
    if (
      generated.length &&
      !confirm(
        IS_REIMAGE
          ? 'Changer de type va effacer les rendus générés (les images du produit restent). Continuer ?'
          : 'Changer de type de produit va effacer les rendus déjà générés. Continuer ?'
      )
    )
      return
    $$('#productType .seg-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    state.productType = btn.dataset.type
    if (IS_REIMAGE) {
      dropGeneratedResults()
    } else {
      clearResults()
      clearCollection()
      loadCollections() // en mode reimage il n'y a pas de collection à choisir
    }
    loadTemplates() // recharge le catalogue + re-rend les décors IA du nouveau type (inclut renderMockups)
    state.lastBatchImage = null // nouveau type = nouveau jeu de favoris -> ré-application auto
    maybeRunFavorites()
  })
)

// Retire UNIQUEMENT les rendus générés — les vignettes conservées du produit restent
// (mode reimage : changement de type produit, la curation en cours ne doit pas se perdre).
function dropGeneratedResults() {
  state.batchToken = {} // périme un lot de favoris en vol
  for (const r of state.results)
    if (!r.kept) {
      if (r.path) fetch(RENDER + '/api/upload/' + r.path.split('/').pop(), { method: 'DELETE' }).catch(() => {})
      dropTwinFile(r.pp)
    }
  state.results = state.results.filter((r) => r.kept)
  renderResults()
  refreshAction()
}

// Vide la galerie de rendus (et supprime les fichiers serveur correspondants)
function clearResults() {
  state.publishKey = null // nouvelle session => nouvelle clé d'idempotence à la prochaine publication
  state.batchToken = {} // périme tout lot de favoris en cours -> ses écritures seront ignorées
  // seuls les rendus Photopea ont un fichier temp serveur (res.path) ; les rendus IA sont des data URI
  for (const r of state.results) {
    if (r.path) fetch(RENDER + '/api/upload/' + r.path.split('/').pop(), { method: 'DELETE' }).catch(() => {})
    dropTwinFile(r.pp)
  }
  state.results = []
  state.mattedOeuvre = state.mattedOeuvreSrc = null // l'œuvre va changer -> invalide le cache passe-partout
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

/* ---------- 2b. Mode « reimage » : refaire les images d'un produit existant ---------- */
// La carte « Produit à refaire » n'existe à l'écran qu'en mode reimage (cachée en mode create).
// Le produit choisi IMPOSE son orientation et son type ; ses images actuelles sont montrées en
// lecture seule (elles seront toutes remplacées par les nouveaux rendus à la publication).
const prodSearch = $('#productSearch'),
  prodList = $('#productList'),
  prodChosen = $('#productChosen')
// type backend ('painting'|'poster'|'tapestry') -> type UI ('toile'|'poster'|'tapisserie')
const BACKEND_TYPE_TO_UI = { painting: 'toile', poster: 'poster', tapestry: 'tapisserie' }
const TYPE_LABELS = { toile: 'Toile', poster: 'Poster', tapisserie: 'Tapisserie' }
const ORI_LABELS = { portrait: 'Portrait', landscape: 'Paysage', square: 'Carré' }

let prodSearchT = null // timer du debounce de la recherche produit
let prodResults = [] // derniers produits affichés dans la liste (pour retrouver l'objet au clic)
let prodSelectToken = null // identité du chargement de contexte en cours (anti-réponse périmée)
let oeuvreLoadToken = null // identité du chargement de l'œuvre en cours (anti-réponse périmée)

// Réécrit l'UI pour le mode reimage : carte produit visible, numéros des cartes, header, libellés.
function initReimageUi() {
  $('.brand em').textContent = 'Refaire les images'
  $('#productCard').classList.remove('hidden')
  $('#uploadCard .card-title').textContent = "2 · L'œuvre (figée)"
  $('#mockupsCard .card-title').textContent = '3 · Mockups'
  $('#resultsCard .card-title').textContent = '4 · Vos rendus'
  // pas de collection en mode reimage ; le type produit est auto -> la carte paramètres ne
  // réapparaît (segment seul) que si le type du produit est indéterminable (choix manuel)
  $('#collectionField').classList.add('hidden')
  $('#paramsCard').classList.add('hidden')
  $('#paramsCard .card-title').textContent = 'Type de produit'
  $('#publishBtn').textContent = 'Remplacer les images'
  // l'œuvre est figée : pas d'upload, pas de favoris auto — la note des mockups change de sens
  $('#mockupsCard .card-note').textContent =
    'Touchez un mockup pour générer un rendu avec l’œuvre du produit. Les nouveaux rendus s’ajoutent à la fin de la galerie.'
  fileInput.disabled = true // le label ne peut plus ouvrir le sélecteur de fichier
  dropzone.classList.add('readonly')
  // les vignettes de la galerie viennent du produit : l'état vide doit le dire
  $('#resultsEmpty').textContent = 'Choisissez un produit : ses images actuelles apparaîtront ici.'
  updateDropzoneLock()
}

// Zone d'upload inactive tant qu'aucun produit n'est choisi (mode reimage uniquement).
// Une fois le produit choisi, la zone n'est PAS déverrouillée pour autant : elle ne sert
// qu'à afficher l'œuvre (figée) — voir applyOeuvre().
function updateDropzoneLock() {
  const locked = IS_REIMAGE && !state.product
  dropzone.classList.toggle('locked', locked)
  const b = $('#dzInner b')
  if (b)
    b.textContent = locked
      ? "Choisissez d'abord le produit à refaire"
      : IS_REIMAGE
        ? 'Chargement de l’œuvre…'
        : 'Touchez pour choisir une image'
}

async function searchProducts(term) {
  try {
    // Accept JSON : en session expirée, Adonis répond 401 JSON au lieu d'un redirect HTML
    const r = await fetch(API + '/api/products/search' + (term ? '?q=' + encodeURIComponent(term) : ''), {
      headers: { Accept: 'application/json' },
    })
    const data = await safeJson(r)
    return (data && data.success && data.data && data.data.products) || []
  } catch {
    return []
  }
}

// Liste de résultats : vignette + titre + badge « brouillon » pour les produits non publiés.
function renderProductList(list) {
  prodResults = list
  prodList.innerHTML =
    list
      .map(
        (p) =>
          `<div class="combo-item product-item" data-id="${escapeHtml(p.id)}">` +
          (p.image
            ? `<img class="pi-thumb" src="${escapeHtml(p.image)}" loading="lazy" alt="">`
            : '<span class="pi-thumb pi-noimg"></span>') +
          `<span class="pi-title">${escapeHtml(p.title)}</span>` +
          (p.status === 'DRAFT' ? '<span class="pi-badge">brouillon</span>' : '') +
          '</div>'
      )
      .join('') || `<div class="combo-item" style="color:var(--muted)">Aucun produit</div>`
  prodList.classList.remove('hidden')
}

// Pastille du produit choisi : titre + type/orientation imposés (ex « Toile · Portrait »).
function renderProductChosen() {
  const p = state.product
  if (!p) return
  const bits = []
  const uiType = BACKEND_TYPE_TO_UI[p.productType]
  if (uiType) bits.push(TYPE_LABELS[uiType])
  if (p.orientation) bits.push(ORI_LABELS[p.orientation])
  prodChosen.innerHTML =
    `<span>${escapeHtml(p.title)}</span>` +
    (bits.length ? `<span class="chosen-info">${bits.join(' · ')}</span>` : '') +
    `<span class="x">✕</span>`
  prodChosen.classList.remove('hidden')
}

// Empreinte ordonnée de la galerie : médias conservés par mediaId, nouveaux rendus par id
// local. Sert au bouton publier (« quelque chose a-t-il changé ? ») ET à la rotation de la
// clé d'idempotence (un payload différent ne doit jamais être dédupliqué par l'ancien).
const galleryFp = () => state.results.map((r) => (r.kept ? r.mediaId : 'new:' + r.id)).join('|')

// L'œuvre du produit — TOUJOURS son image n°2 (index 1) : c'est l'image par défaut que le
// Publisher place en 2e position à chaque publication. Produit à une seule image : celle-là.
// Elle s'affiche dans la carte « L'œuvre (figée) » et sert de SOURCE aux nouveaux rendus,
// mais n'est jamais ré-uploadée (référencée par mediaId à la publication).
function applyOeuvre(ctx) {
  const imgs = (ctx && ctx.images) || []
  const o = imgs.length >= 2 ? imgs[1] : imgs[0] || null
  state.oeuvre = o && o.id ? { mediaId: o.id, url: o.fullUrl || o.url, alt: o.alt || null } : null
  state.imageDataUrl = null
  state.needsResize = false
  state.sourceRatio = null
  state.lastBatchImage = null
  state.decor = null // un décor validé pour l'ancien produit ne doit pas servir au nouveau
  const token = (oeuvreLoadToken = {})
  const badge = $('#orientationBadge')
  if (!state.oeuvre || !state.oeuvre.url) {
    sourcePreview.src = ''
    sourcePreview.classList.add('hidden')
    dzInner.classList.remove('hidden')
    state.orientation = ctx.orientation || null
    badge.classList.add('hidden')
    toast('Produit sans œuvre exploitable — choisissez-en un autre.', 'err')
    renderMockups()
    return
  }
  // affichage immédiat (le <img> charge le CDN directement, pas de CORS pour un simple affichage)
  sourcePreview.src = state.oeuvre.url
  sourcePreview.classList.remove('hidden')
  dzInner.classList.add('hidden')
  // orientation : verrou produit si connu, sinon déduite des dimensions réelles de l'œuvre
  const setOri = (ori) => {
    state.orientation = ori
    badge.textContent = ORI_LABELS[ori] || ori
    badge.className = 'badge ' + ori
    badge.classList.remove('hidden')
    renderMockups()
    refreshAction()
  }
  if (ctx.orientation) setOri(ctx.orientation)
  const probe = new Image()
  probe.onload = () => {
    if (token !== oeuvreLoadToken) return
    state.sourceRatio = probe.naturalWidth / probe.naturalHeight
    if (!ctx.orientation) {
      const r = state.sourceRatio
      setOri(r >= 0.9 && r <= 1.1 ? 'square' : r < 0.9 ? 'portrait' : 'landscape')
    }
  }
  probe.src = state.oeuvre.url
  // data URL pour la GÉNÉRATION (Photopea / décor IA). En cas d'échec (CORS/réseau),
  // la curation — supprimer, réordonner, publier — reste entièrement possible.
  urlToDataUrl(state.oeuvre.url)
    .then((d) => {
      if (token !== oeuvreLoadToken) return
      state.imageDataUrl = d
    })
    .catch(() => {
      if (token !== oeuvreLoadToken) return
      toast('Œuvre non téléchargeable — génération indisponible (curation toujours possible).', 'err')
    })
}

// Galerie seedée avec les images ACTUELLES du produit (sauf l'œuvre) : chaque vignette est
// normale — supprimable, réordonnable — et référencée par son mediaId (jamais ré-uploadée,
// URL CDN et alt intacts). Les nouveaux rendus générés s'ajouteront à la suite.
function seedGalleryFromProduct(ctx) {
  const imgs = (ctx && ctx.images) || []
  const oeuvreId = state.oeuvre && state.oeuvre.mediaId
  state.results = imgs
    .filter((im) => im.id !== oeuvreId)
    .map((im) => ({
      id: 'keep-' + im.id,
      kept: true,
      mediaId: im.id,
      path: null, // aucun fichier temp serveur : rien à nettoyer côté render server
      url: im.url || im.fullUrl,
      context: null,
      label: 'Image actuelle',
    }))
  state.initialFp = galleryFp()
  renderResults()
}

function clearProduct() {
  state.product = null
  state.publishKey = null // changement/désélection de produit => nouvelle clé d'idempotence
  state.publishFp = null
  prodSelectToken = {} // périme un chargement de contexte encore en vol
  oeuvreLoadToken = {} // périme un chargement d'œuvre encore en vol
  prodChosen.classList.add('hidden')
  prodChosen.innerHTML = ''
  prodSearch.value = ''
  prodSearch.classList.remove('hidden')
  prodList.classList.add('hidden')
  $('#productVideoNote').classList.add('hidden')
  $('#paramsCard').classList.add('hidden')
  // l'œuvre et la galerie appartiennent au produit : tout part avec lui
  state.oeuvre = null
  state.imageDataUrl = null
  state.orientation = null
  state.sourceRatio = null
  state.needsResize = false
  state.initialFp = null
  state.decor = null
  sourcePreview.src = ''
  sourcePreview.classList.add('hidden')
  dzInner.classList.remove('hidden')
  $('#orientationBadge').classList.add('hidden')
  clearResults() // vide aussi les rendus générés (fichiers temp serveur compris)
  renderMockups()
  updateDropzoneLock()
  refreshAction()
}

// Sélection : pastille immédiate puis chargement du contexte (orientation, type, images, vidéo).
async function selectProduct(p) {
  const token = (prodSelectToken = {})
  prodList.classList.add('hidden')
  prodSearch.classList.add('hidden')
  prodChosen.innerHTML = `<span>${escapeHtml(p.title)}</span><span class="chosen-info">chargement…</span><span class="x">✕</span>`
  prodChosen.classList.remove('hidden')
  let ctx
  try {
    const r = await fetch(API + '/api/products/reimage-context?id=' + encodeURIComponent(p.id), {
      headers: { Accept: 'application/json' },
    })
    const data = await safeJson(r)
    if (!r.ok || !data.success || !data.data)
      throw new Error(data.message || data.error || 'contexte indisponible (' + r.status + ')')
    ctx = data.data
  } catch (e) {
    if (token !== prodSelectToken) return // désélectionné / re-sélectionné entre-temps
    clearProduct()
    return toast('Produit : ' + e.message, 'err')
  }
  if (token !== prodSelectToken) return
  applyReimageContext(ctx)
}

// Applique le contexte du produit : verrouillage type/orientation, œuvre figée (image n°2),
// galerie re-seedée avec les images actuelles du produit. Changer de produit = session neuve.
function applyReimageContext(ctx) {
  state.product = ctx
  state.publishKey = null // tout changement de produit => nouvelle clé d'idempotence
  state.publishFp = null

  // type de produit auto : segment caché si le type est connu, sinon choix manuel
  const uiType = BACKEND_TYPE_TO_UI[ctx.productType] || null
  if (uiType) {
    $('#paramsCard').classList.add('hidden')
    if (uiType !== state.productType) {
      // même bascule que le segment Toile/Poster/Tapisserie, SANS recharger les collections
      $$('#productType .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === uiType))
      state.productType = uiType
      state.lastBatchImage = null
      state.batchToken = {} // périme un lot de favoris encore en vol (il rendait l'ancien type)
      loadTemplates() // recharge le catalogue du nouveau type (inclut renderMockups)
    }
  } else {
    $('#paramsCard').classList.remove('hidden')
  }

  renderProductChosen()
  $('#productVideoNote').classList.toggle('hidden', !ctx.hasVideo)
  updateDropzoneLock()

  // v2 : changer de produit = session entièrement re-seedée depuis CE produit (les rendus
  // d'une éventuelle session précédente venaient d'une AUTRE œuvre — plus de sens ici).
  clearResults()
  applyOeuvre(ctx)
  seedGalleryFromProduct(ctx)
  refreshAction()
}

// Reset COMPLET de la session reimage après un remplacement réussi (D10).
// clearProduct() emporte désormais l'œuvre, la galerie et les empreintes.
function resetReimageSession() {
  state.lastBatchImage = null
  fileInput.value = ''
  changeBtn.classList.add('hidden')
  updateRatioUI()
  clearProduct() // produit désélectionné (re-verrouille la zone) + clearResults + refreshAction
}

if (IS_REIMAGE && prodSearch) {
  // recherche débouncée (300 ms) ; champ vide = les 20 produits les plus récemment modifiés
  prodSearch.addEventListener('input', () => {
    clearTimeout(prodSearchT)
    const term = prodSearch.value.trim()
    prodSearchT = setTimeout(async () => {
      const list = await searchProducts(term)
      // réponse périmée (terme modifié / produit déjà choisi entre-temps) -> on l'ignore
      if (prodSearch.value.trim() !== term || prodSearch.classList.contains('hidden')) return
      renderProductList(list)
    }, 300)
  })
  prodSearch.addEventListener('focus', () => prodSearch.dispatchEvent(new Event('input')))
  prodList.addEventListener('click', (e) => {
    const item = e.target.closest('.combo-item')
    if (!item || !item.dataset.id) return
    const p = prodResults.find((x) => String(x.id) === item.dataset.id)
    if (p) selectProduct(p)
  })
  prodChosen.addEventListener('click', (e) => {
    if (e.target.classList.contains('x')) clearProduct()
  })
  // fermeture PAR INSTANCE : un clic hors du combo produit ferme SA liste (sans toucher aux autres)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#productCard .combo')) prodList.classList.add('hidden')
  })
  // l'œuvre est FIGÉE : le label n'ouvre jamais le sélecteur de fichier en mode reimage
  dropzone.addEventListener('click', (e) => {
    e.preventDefault()
    if (!state.product) toast("Choisissez d'abord le produit à refaire", 'err')
  })
}

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

// Libellés des sections actuellement présentes dans la grille (PSD + décors IA compatibles), triés
// comme la grille (« Autre » en dernier). Sert au sélecteur « Ranger dans… » et au choix au nettoyage.
function gridSectionLabels() {
  const ori = state.orientation
  const set = new Set()
  for (const cat of state.templates)
    for (const sub of cat.subcategories)
      if (sub.layouts[ori]) set.add(sectionForPsd(sub.layouts[ori].psd, cat.name))
  for (const t of state.saved.ai.filter((t) => !t.product || PRODUCT_TO_TYPE[t.product] === state.productType))
    set.add(t.section || roomLabelOf(t.roomType))
  return [...set].sort((a, b) => (a === 'Autre') - (b === 'Autre') || a.localeCompare(b, 'fr'))
}

// Section « Mockups » UNIFIÉE : catalogue Photopea + décors enregistrés (IA générés OU photos
// importées nettoyées — traités pareil), regroupés PAR PIÈCE. Seul le badge PS (Photoshop)
// subsiste ; l'étoile marque un favori (rendu auto quand l'image est prête).
function renderMockups() {
  const grid = $('#mockupGrid'),
    hint = $('#mockupsHint')
  grid.innerHTML = ''
  grid.classList.toggle('disabled', !!state.needsResize)
  const decorBtn = $('#decorBtn')
  if (decorBtn) decorBtn.classList.toggle('hidden', !(state.orientation && !state.needsResize))
  const uploadBtn = $('#mockupUploadBtn')
  if (uploadBtn) uploadBtn.classList.toggle('hidden', !(state.orientation && !state.needsResize))
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
      if (L) push(sectionForPsd(L.psd, cat.name), { kind: 'photopea', cat, sub, L })
    }
  }
  for (const t of state.saved.ai.filter((t) => !t.product || PRODUCT_TO_TYPE[t.product] === state.productType)) {
    push(t.section || roomLabelOf(t.roomType), { kind: 'ai', data: t })
  }
  const rooms = Object.keys(groups).sort((a, b) => (a === 'Autre') - (b === 'Autre') || a.localeCompare(b, 'fr'))
  let count = 0
  for (const room of rooms) {
    const section = document.createElement('div')
    section.className = 'mockup-section'
    const head = document.createElement('div')
    head.className = 'mockup-cat'
    head.textContent = room
    section.appendChild(head)
    // une section = une seule rangée défilable horizontalement (carrousel)
    const row = document.createElement('div')
    row.className = 'mockup-row'
    for (const e of groups[room]) {
      row.appendChild(buildMockupCell(e, ori))
      count++
    }
    section.appendChild(row)
    grid.appendChild(section)
  }
  if (state.needsResize) {
    hint.textContent = "⚠️ Retaillez l'image au bon format pour débloquer les mockups"
  } else {
    hint.textContent = count ? `${count} mockup(s) en ${labelOri(ori)}` : `Aucun mockup en ${labelOri(ori)}`
    if (!count) grid.innerHTML = `<div class="mockup-empty">Aucun mockup disponible en ${labelOri(ori)}.</div>`
  }
}

// Vignette de la section Mockups : mockup Photopea (badge PS) OU décor enregistré (sans badge,
// qu'il soit généré par IA ou importé/nettoyé). Tap = générer / réutiliser ; appui long = menu.
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
        { label: '📁 Ranger dans une section…', onClick: () => openSectionPicker({ kind: 'photopea', subfolder: subfolderOf(L.psd), current: sectionForPsd(L.psd, cat.name), origin: cat.name, name: sub.name }) },
        { label: '🗑 Supprimer du disque', danger: true, onClick: () => deleteMockup({ psd: L.psd, preview: L.preview || null, name: sub.name }) },
      ]
    })
  } else {
    const t = e.data
    const oriT = t.orientation
    const compatible = !oriT || oriT === ori
    cell.className = 'mockup-cell saved-cell' + (compatible ? '' : ' incompatible')
    cell.title = compatible ? '' : `Décor en ${labelOri(oriT)} — changez l'orientation de l'image`
    cell.innerHTML = `${favStarHtml(!!t.favorite)}<img src="${renderUrl(t.url)}" loading="lazy" alt=""><div class="mc-label">${escapeHtml(t.theme || 'Décor IA')}</div>`
    cell.addEventListener('click', () => {
      if (cell._suppressClick) { cell._suppressClick = false; return }
      reuseSavedDecor(t)
    })
    attachLongPress(cell, () => [
      { label: t.favorite ? '★ Retirer des favoris' : '★ Ajouter aux favoris', onClick: () => toggleAiFavorite(t) },
      { label: '📁 Ranger dans une section…', onClick: () => openSectionPicker({ kind: 'ai', id: t.id, current: t.section || roomLabelOf(t.roomType), origin: roomLabelOf(t.roomType), name: t.theme || 'Décor IA' }) },
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
  if (!state.imageDataUrl)
    return toast(
      IS_REIMAGE ? "L'œuvre n'est pas encore chargée — réessayez dans un instant" : 'Choisissez une image',
      'err'
    )
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
    const res = {
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5),
      path: data.url,
      url: renderUrl(data.url),
      context: data.mockupContext,
      label,
      psd, // retenu pour re-générer le jumeau passe-partout (poster)
    }
    state.results.push(res)
    renderResults()
    refreshAction()
    queueTwin(res)
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

/* ---------- Passe-partout : jumeaux d'affiche (poster) ----------
   Pour CHAQUE mockup d'un poster on publie un 2e visuel : le même décor mais avec l'œuvre
   entourée d'une marge blanche (effet passe-partout). On re-rend le mockup avec une œuvre MAT-ÉE
   (construite au canvas, sans IA) : MÊMES dimensions que l'œuvre (ratio conservé -> insertion
   identique), bordure blanche ÉGALE en pixels sur les 4 côtés, œuvre rétrécie en COVER dans le
   cadre intérieur (remplit bord à bord, léger rognage accepté). Le jumeau « monte » sur son
   mockup source (res.pp) : lié 1:1, re-roll + désactivation possibles, supprimé avec lui. À la
   publication, tous les jumeaux sont ajoutés EN FIN de tableau, dans l'ordre des mockups. */
const PP_RATIO = 0.08 // bordure blanche = 8% du petit côté de l'œuvre (réglable)
const ppEligible = () => state.productType === 'poster'

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
      // COVER : remplit (iw×ih) en gardant le ratio de l'œuvre, rogne le surplus (léger)
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
// Source de l'œuvre (création : l'upload ; reimage : l'image n°2 figée du produit).
async function oeuvreSourceDataUrl() {
  if (state.imageDataUrl) return state.imageDataUrl
  if (state.oeuvre && state.oeuvre.url) return await urlToDataUrl(state.oeuvre.url)
  return null
}
// œuvre mat-ée, mise en cache (recalcul si l'œuvre change).
async function getMattedOeuvre() {
  const src = await oeuvreSourceDataUrl()
  if (!src) return null
  if (state.mattedOeuvre && state.mattedOeuvreSrc === src) return state.mattedOeuvre
  state.mattedOeuvre = await buildMattedOeuvre(src)
  state.mattedOeuvreSrc = src
  return state.mattedOeuvre
}
// Supprime le fichier temp serveur d'un jumeau (rendus Photopea uniquement ; IA = data URI).
function dropTwinFile(pp) {
  if (pp && pp.path) fetch(RENDER + '/api/upload/' + pp.path.split('/').pop(), { method: 'DELETE' }).catch(() => {})
}
// (Re)génère le jumeau passe-partout d'un rendu source, via le MÊME moteur (PSD ou décor IA),
// en réinjectant l'œuvre mat-ée. Écrit sur res.pp. Ne re-rend QUE la 2e rangée (renderPpRow) :
// le rendu normal du haut ne change pas -> n'interrompt pas un éventuel glisser en cours.
async function generateTwin(res) {
  if (!ppEligible() || res.kept || !res.psd === !res.decor) return // ni source PSD ni décor IA -> pas de jumeau
  if (res.pp && res.pp.optedOut) return
  dropTwinFile(res.pp) // filet de sécurité (le re-roll nettoie déjà via rerollTwin)
  res.pp = { busy: true }
  renderPpRow()
  try {
    const matted = await getMattedOeuvre()
    if (!matted) throw new Error('œuvre indisponible')
    let twin
    if (res.psd) {
      const r = await fetch(RENDER + '/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ psd: res.psd, image: matted, mockupContext: res.context }),
      })
      const data = await r.json()
      if (!data.success) throw new Error(data.error || 'échec du rendu')
      twin = { url: renderUrl(data.url), path: data.url }
    } else {
      const img = await callInsertJob({
        decor: res.decor,
        artwork: matted,
        target: state.orientation,
        product: productOf(state.productType),
        fidelity: res.fidelity || 'standard',
      })
      twin = { url: img, path: null }
    }
    if (!state.results.includes(res)) {
      dropTwinFile(twin) // source supprimée entre-temps -> on jette le rendu
      return
    }
    res.pp = { ...twin, busy: false, optedOut: false }
  } catch (e) {
    if (state.results.includes(res)) res.pp = { busy: false, error: true }
    toast('Passe-partout : ' + e.message, 'err')
  }
  renderPpRow()
  refreshAction()
}
// File d'attente : génère les jumeaux EN ARRIÈRE-PLAN, un par un (n'embouteille pas le lot de
// favoris ni l'UI ; les insertions IA sont longues -> jamais en parallèle).
let twinQueue = Promise.resolve()
function queueTwin(res) {
  if (!ppEligible() || res.kept) return
  twinQueue = twinQueue.then(() => generateTwin(res)).catch(() => {})
}
// Re-roll : on supprime le fichier de l'ANCIEN jumeau AVANT d'écraser res.pp (sinon son chemin
// est perdu et le fichier temp serveur fuite à chaque re-roll PSD), puis on relance.
function rerollTwin(res) {
  dropTwinFile(res.pp)
  res.pp = { busy: true }
  renderPpRow()
  queueTwin(res)
}
// Active/désactive le passe-partout d'un rendu (opt-out par mockup).
function toggleTwin(id) {
  const res = state.results.find((r) => r.id === id)
  if (!res) return
  if (res.pp && !res.pp.optedOut) {
    dropTwinFile(res.pp)
    res.pp = { optedOut: true }
    renderPpRow()
    refreshAction()
  } else {
    res.pp = { busy: true }
    renderPpRow() // affiche le spinner tout de suite -> le bouton « Réactiver » disparaît (anti double-clic)
    queueTwin(res)
  }
}

async function loadSavedTemplates() {
  try {
    const r = await fetch(RENDER + '/api/saved-templates')
    const data = await r.json()
    state.saved = { photopea: data.photopea || [], ai: data.ai || [] }
    state.sectionOverrides = data.sectionOverrides || {}
  } catch {
    state.saved = { photopea: [], ai: [] }
    state.sectionOverrides = {}
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

/* ---------- Ranger un mockup dans une section (ré-étiquetage non destructif) ---------- */
// Cible courante du sélecteur : { kind:'photopea'|'ai', subfolder?|id?, current, origin, name }.
let sectionTarget = null
function openSectionPicker(target) {
  sectionTarget = target
  $('#sectionPickerName').textContent = target.name ? `« ${target.name} »` : ''
  // Candidats : sections présentes dans la grille + la section d'ORIGINE du mockup (pour réinitialiser).
  const labels = gridSectionLabels()
  if (!labels.includes(target.origin)) labels.push(target.origin)
  labels.sort((a, b) => (a === 'Autre') - (b === 'Autre') || a.localeCompare(b, 'fr'))
  const list = $('#sectionList')
  list.innerHTML = ''
  for (const label of labels) {
    const isCurrent = label === target.current
    const isOrigin = label === target.origin
    const b = document.createElement('button')
    b.className = 'section-opt' + (isCurrent ? ' current' : '')
    b.disabled = isCurrent
    const tag = isOrigin ? ' · origine' : ''
    b.innerHTML = `<span>${escapeHtml(label)}${tag}</span>${isCurrent ? '<span class="section-check">✓</span>' : ''}`
    b.addEventListener('click', () => applySection(label))
    list.appendChild(b)
  }
  $('#sectionNewInput').value = ''
  $('#sectionOverlay').classList.remove('hidden')
}
function closeSectionPicker() {
  $('#sectionOverlay').classList.add('hidden')
  sectionTarget = null
}
// Applique le rangement. Choisir la section d'ORIGINE efface l'étiquette (retour au défaut).
async function applySection(label) {
  if (!sectionTarget) return
  const t = sectionTarget
  const section = label === t.origin ? null : label
  try {
    if (t.kind === 'ai') {
      const r = await fetch(RENDER + '/api/saved-templates/ai/' + t.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section }),
      })
      if (!r.ok) throw new Error('échec')
    } else {
      const r = await fetch(RENDER + '/api/mockup-section', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subfolder: t.subfolder, section }),
      })
      if (!r.ok) throw new Error('échec')
    }
    closeSectionPicker()
    toast(section ? `Rangé dans « ${label} » ✓` : "Remis dans sa section d'origine ✓", 'ok')
    await loadSavedTemplates() // recharge overrides + décors -> renderMockups()
  } catch (e) {
    toast('Erreur : ' + e.message, 'err')
  }
}
$('#sectionNewAdd').addEventListener('click', () => {
  const labels = gridSectionLabels()
  if (sectionTarget && !labels.includes(sectionTarget.origin)) labels.push(sectionTarget.origin)
  const resolved = resolveSection($('#sectionNewInput').value, labels)
  if (!resolved) return toast('Saisissez un nom de section', 'err')
  applySection(resolved)
})
$('#sectionNewInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sectionNewAdd').click() })
$('#sectionCancel').addEventListener('click', closeSectionPicker)

/* ---------- Favoris automatiques ---------- */
// Dès que l'image est au bon format, on applique l'œuvre à TOUS les favoris, en un lot, une
// seule fois par œuvre : mockups Photopea favoris -> rendu ; décors IA favoris -> insertion.
function maybeRunFavorites() {
  if (IS_REIMAGE) return // v2 : génération 100 % manuelle (pas de lot auto sur l'œuvre du produit)
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
    queueTwin(res) // jumeau passe-partout en arrière-plan (poster)
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
    psd: pp.psd, // retenu pour le jumeau passe-partout
  }
}
async function insertFavoriteAi(ai, image, ori, product) {
  const decor = await urlToDataUrl(renderUrl(ai.url))
  const img = await callInsertJob({ decor, artwork: image, target: ori, product, fidelity: 'standard' })
  return {
    id: 'ins' + Date.now() + Math.random().toString(36).slice(2, 5),
    path: null, url: img, context: 'Décor sur-mesure (IA)', label: 'Décor IA',
    decor, fidelity: 'standard', // retenus pour le jumeau passe-partout
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
    cell.innerHTML =
      `<div class="num">${i + 1}</div>` +
      (IS_REIMAGE && !res.kept ? '<span class="new-badge">nouveau</span>' : '') +
      `<button class="del" title="Supprimer">✕</button><img src="${res.url}" alt="" draggable="false">`
    cell.querySelector('.del').addEventListener('click', (ev) => {
      ev.stopPropagation()
      removeResult(res.id)
    })
    attachDrag(cell, res)
    grid.appendChild(cell)
  })
  renderPpRow()
}
// 2e rangée « passe-partout » (poster) : les jumeaux EN GRAND (même taille que les rendus du
// haut), cliquables -> lightbox pour les analyser, avec re-roll + désactivation. Grille SÉPARÉE
// (#ppGrid) : aucune interaction avec le drag du haut (qui n'itère que #resultsGrid). Même numéro
// que le rendu source pour la correspondance haut/bas.
function renderPpRow() {
  const section = $('#ppSection'),
    grid = $('#ppGrid')
  if (!section || !grid) return
  grid.innerHTML = ''
  const show = ppEligible() && state.results.some((r) => !r.kept)
  section.classList.toggle('hidden', !show)
  if (!show) return
  state.results.forEach((res, i) => {
    if (res.kept) return
    grid.appendChild(buildPpCell(res, i + 1))
  })
}
function buildPpCell(res, num) {
  const pp = res.pp
  const cell = document.createElement('div')
  cell.className = 'result-cell pp-cell'
  const numHtml = `<div class="num">${num}</div>`
  if (pp && pp.optedOut) {
    cell.classList.add('pp-muted')
    cell.innerHTML = numHtml + `<div class="pp-msg">Passe-partout désactivé<button class="pp-act pp-reactivate">Réactiver</button></div>`
    cell.querySelector('.pp-reactivate').addEventListener('click', (ev) => { ev.stopPropagation(); toggleTwin(res.id) })
    return cell
  }
  if (pp && pp.error) {
    cell.classList.add('pp-muted')
    cell.innerHTML = numHtml + `<div class="pp-msg">Échec du passe-partout<button class="pp-act pp-reroll">↻ Réessayer</button></div>`
    cell.querySelector('.pp-reroll').addEventListener('click', (ev) => { ev.stopPropagation(); rerollTwin(res) })
    return cell
  }
  if (pp && pp.url) {
    cell.innerHTML =
      numHtml +
      `<button class="del pp-disable" title="Désactiver le passe-partout">✕</button>` +
      `<button class="pp-reroll-btn" title="Régénérer">↻</button>` +
      `<img src="${pp.url}" alt="" draggable="false"><span class="pp-zoom" title="Agrandir">⤢</span>`
    cell.addEventListener('click', () => openLightbox(pp.url))
    cell.querySelector('.pp-disable').addEventListener('click', (ev) => { ev.stopPropagation(); toggleTwin(res.id) })
    cell.querySelector('.pp-reroll-btn').addEventListener('click', (ev) => { ev.stopPropagation(); rerollTwin(res) })
    return cell
  }
  // busy (en cours) ou pas encore lancé (en file d'attente)
  cell.classList.add('pp-loading')
  cell.innerHTML = numHtml + `<div class="pp-msg"><span class="pp-spin big"></span>${pp && pp.busy ? 'Passe-partout…' : 'En attente…'}</div>`
  return cell
}
function removeResult(id) {
  const res = state.results.find((r) => r.id === id)
  state.results = state.results.filter((r) => r.id !== id)
  renderResults()
  refreshAction()
  if (res && res.path) fetch(RENDER + '/api/upload/' + res.path.split('/').pop(), { method: 'DELETE' }).catch(() => {})
  if (res) dropTwinFile(res.pp) // jumeau passe-partout lié -> supprimé avec son mockup
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
const ARM_MS = 350, MOVE_SLOP = 10, EDGE = 64, MAX_V = 16, EDGE_DELAY = 200, EDGE_RAMP = 320
let drag = null

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return // multi-touch : on ignore les autres doigts
  drag.lastX = e.clientX
  drag.lastY = e.clientY
  if (!drag.armed) {
    // en deçà du seuil : intention pas encore tranchée -> on attend
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) <= MOVE_SLOP) return
    // SOURIS : un déplacement franc EST le glisser (aucun scroll natif à voler à la souris) -> on arme
    // tout de suite, sans appui long. TACTILE : avant l'armement (appui long), un déplacement = scroll
    // de la liste -> on rend la main à la page.
    if (drag.pointerType === 'mouse') {
      armDrag()
      if (!drag) return // armDrag a pu abandonner (cellule détachée entre-temps)
    } else {
      cancelDrag()
      return
    }
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
  // mesure une fois le « chrome » fixe (header collant + barre d'action) pour caler les bandes d'auto-scroll
  const hdr = document.querySelector('.topbar'), ftr = document.querySelector('.actionbar')
  drag.edgeTop = hdr ? hdr.getBoundingClientRect().bottom : 0
  drag.edgeBottom = ftr ? ftr.getBoundingClientRect().top : window.innerHeight
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

// Auto-scroll de bord — pour traverser une longue liste. Mais on NE défile PAS dès qu'on frôle le
// bord : sinon un simple passage par la bande haute/basse en changeant de rangée ferait défiler la
// page (ce que l'utilisateur prenait pour un « saut »). Il faut que le doigt S'ATTARDE au bord
// (EDGE_DELAY) avant que ça démarre, puis montée en douceur (EDGE_RAMP). Un aller-retour rapide ne
// déclenche donc rien ; seul un maintien volontaire au bord fait défiler.
function computeScrollDir(y) {
  // bandes calées sur la zone VISIBLE (entre le bas du header collant et le haut de la barre d'action
  // fixe), pas sur le viewport brut — sinon la bande basse tombe SOUS la barre et le scroll vers le bas
  // serait injoignable. Vitesse max au bord réellement touchable (juste sous le header / au-dessus de la barre).
  const top = drag.edgeTop, bottom = drag.edgeBottom || window.innerHeight
  if (y < top + EDGE) drag.scrollDir = -(1 - Math.max(0, y - top) / EDGE)
  else if (y > bottom - EDGE) drag.scrollDir = Math.min(1, (y - (bottom - EDGE)) / EDGE)
  else drag.scrollDir = 0
}
function startAutoScroll() {
  const tick = (ts) => {
    if (!drag || !drag.armed) return
    if (drag.scrollDir) {
      if (!drag.edgeSince) drag.edgeSince = ts // 1re frame au bord -> on démarre le compteur d'attente
      const held = ts - drag.edgeSince
      if (held >= EDGE_DELAY) {
        const ramp = Math.min(1, (held - EDGE_DELAY) / EDGE_RAMP) // 0 -> 1 : démarrage doux, pas de à-coup
        window.scrollBy(0, drag.scrollDir * MAX_V * ramp)
        moveProxy(drag.lastX, drag.lastY) // position:fixed -> on garde le proxy collé au doigt
        updateHover(drag.lastX, drag.lastY) // un nouveau contenu défile sous le doigt
      }
    } else {
      drag.edgeSince = 0 // sorti de la zone -> on réarme le délai (un simple passage ne scrolle jamais)
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
  refreshAction() // reimage v2 : un simple réordonnancement est un changement publiable
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
      id: cell.dataset.id, cell, res, pointerId: e.pointerId, pointerType: e.pointerType,
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      armed: false, moved: false, captured: false, placeholder: null,
      w: 0, h: 0, grabX: 0, grabY: 0, scrollDir: 0, edgeSince: 0, edgeTop: 0, edgeBottom: 0, raf: 0, timer: null,
    }
    // Tactile/stylet : armement par appui long (350 ms) pour départager le glisser d'un scroll de liste.
    // Souris : pas de timer — un déplacement franc arme le glisser (cf. onDragMove), un simple clic agrandit.
    if (e.pointerType !== 'mouse') drag.timer = setTimeout(() => { if (drag) armDrag() }, ARM_MS)
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
// Un défilement HORIZONTAL d'un carrousel de mockups (.mockup-row) est anodin : il ne doit PAS
// refermer le menu. Sinon, au bord gauche (1re vignette, scrollLeft=0), le snap-back du carrousel
// émet un 'scroll' qui referme le menu aussitôt ouvert (constaté sur mobile). Un vrai scroll de page ferme.
function onCtxScroll(e) {
  const t = e.target
  if (t && t.closest && t.closest('.mockup-row')) return
  closeContextMenu()
}
function closeContextMenu() {
  document.removeEventListener('pointerdown', onCtxOutsidePointer, true)
  document.removeEventListener('scroll', onCtxScroll, true)
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
  document.addEventListener('scroll', onCtxScroll, true)
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
  if (IS_REIMAGE) return refreshActionReimage()
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

// Variante reimage v2 : actif ssi produit choisi + œuvre identifiée + ≥1 mockup en galerie
// + au moins un CHANGEMENT réel (suppression, réordonnancement ou nouveau rendu).
// Garder ≥1 mockup protège l'invariant « œuvre = image n°2 » (sinon elle passerait en n°1).
function refreshActionReimage() {
  const info = $('#actionInfo'),
    btn = $('#publishBtn')
  const n = state.results.length
  if (!state.product) {
    info.textContent = 'Choisissez le produit à refaire'
    btn.disabled = true
    return
  }
  if (!state.oeuvre) {
    info.textContent = 'Produit sans œuvre exploitable'
    btn.disabled = true
    return
  }
  if (!n) {
    info.textContent = 'Gardez ou générez au moins un mockup'
    btn.disabled = true
    return
  }
  const dirty = state.initialFp !== null && galleryFp() !== state.initialFp
  const kept = state.results.filter((r) => r.kept).length
  const fresh = n - kept
  const parts = [state.product.title, `${kept} conservée${kept > 1 ? 's' : ''}`]
  if (fresh) parts.push(`${fresh} nouvelle${fresh > 1 ? 's' : ''}`)
  info.textContent = parts.join(' · ') + (dirty ? '' : ' — aucun changement')
  btn.disabled = !dirty
}

$('#publishBtn').addEventListener('click', async () => {
  const btn = $('#publishBtn')
  if (btn.disabled) return
  btn.disabled = true
  progress.show('Préparation des images…')
  if (IS_REIMAGE) $('#progressTitle').textContent = 'Remplacement en cours…'
  try {
    // ordre: [mockup1, original, mockup2, ...] — l'œuvre est TOUJOURS l'image n°2 (l'image
    // par défaut du produit). En reimage v2, les vignettes conservées et l'œuvre sont
    // référencées par mediaId (jamais re-téléversées) ; seuls les nouveaux rendus partent en base64.
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
      const res = state.results[i]
      if (IS_REIMAGE && res.kept) {
        imgs.push({ mediaId: res.mediaId, type: 'mockup', clientId: res.id })
      } else {
        imgs.push({ base64Image: await toB64(res.url), type: 'mockup', mockupContext: res.context, clientId: res.id })
      }
      if (i === 0)
        imgs.push(
          IS_REIMAGE
            ? { mediaId: state.oeuvre.mediaId, type: 'original' }
            : { base64Image: state.imageDataUrl, type: 'original' }
        )
    }
    // Passe-partout (poster) : on AJOUTE les jumeaux EN FIN de tableau, dans l'ordre des mockups
    // (l'œuvre n°2 n'est jamais doublée). Chacun réutilisera l'alt/le filename de son mockup source
    // côté backend (passePartoutOf=clientId, suffixe « passe-partout », zéro IA).
    if (ppEligible()) {
      const twins = state.results.filter((r) => !r.kept && r.pp && r.pp.url && !r.pp.optedOut)
      for (let i = 0; i < twins.length; i++) {
        const res = twins[i]
        progress.step(`Préparation des passe-partout… (${i + 1}/${twins.length})`)
        imgs.push({
          base64Image: await toB64(res.pp.url),
          type: 'mockup',
          mockupContext: res.context,
          passePartout: true,
          passePartoutOf: res.id,
        })
      }
    }
    // Clé d'idempotence : stable tant que le CONTENU à publier ne change pas — un re-clic
    // après un timeout (524) renvoie le résultat déjà obtenu au lieu d'un doublon. En
    // reimage, une galerie MODIFIÉE après un échec doit repartir avec une clé neuve
    // (sinon le backend dédupliquerait un payload différent).
    const fpNow = IS_REIMAGE ? galleryFp() : null
    if (!state.publishKey || (IS_REIMAGE && state.publishFp !== fpNow)) {
      state.publishKey =
        self.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : 'pk_' + Date.now() + '_' + Math.random().toString(36).slice(2)
      state.publishFp = fpNow
    }
    // mode reimage : on remplace les images d'un produit existant (mêmes images, autre cible)
    const payload = IS_REIMAGE
      ? {
          productId: state.product.id,
          ratio: state.orientation,
          images: imgs,
          idempotencyKey: state.publishKey,
          // produit sans metafield artwork.type : on transmet le choix manuel du segment
          ...(state.product.productType ? {} : { productType: TYPE_MAP[state.productType] }),
        }
      : {
          images: imgs,
          ratio: state.orientation,
          productType: TYPE_MAP[state.productType],
          parentCollection: { id: state.collection.id, title: state.collection.title },
          idempotencyKey: state.publishKey,
        }
    progress.step(
      IS_REIMAGE
        ? 'Remplacement des images sur Shopify… (cela peut prendre jusqu’à 1 min)'
        : 'Création du produit sur Shopify… (cela peut prendre jusqu’à 1 min)'
    )
    // timeout de sécurité (le backend peut être long : IA + Shopify)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 180000)
    let r
    try {
      r = await fetch(
        API + (IS_REIMAGE ? '/api/shopify-product-publisher/replace-images' : '/api/shopify-product-publisher/publish'),
        {
          method: 'POST',
          // reimage : Accept JSON pour que l'auth expirée réponde 401 JSON (pas un redirect HTML)
          headers: IS_REIMAGE
            ? { 'Content-Type': 'application/json', Accept: 'application/json' }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        }
      )
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
    // success !== true (et pas === false) : une réponse HTML (ex. redirect /login si
    // session expirée) donne data={} et ne doit PAS passer pour un succès.
    if (!r.ok || data.success !== true) {
      const detail =
        data.message ||
        data.error ||
        (data.errors ? JSON.stringify(data.errors) : '') ||
        'Erreur serveur (HTTP ' + r.status + ')'
      throw new Error(detail)
    }
    if (data.pending) {
      // Une publication avec cette même clé est déjà en cours côté serveur :
      // on n'en relance pas une autre (évite les doublons).
      progress.done(
        IS_REIMAGE
          ? '⏳ Remplacement déjà en cours. Vérifie ta boutique dans une minute (ne relance pas).'
          : '⏳ Publication déjà en cours. Vérifie ta boutique dans une minute (ne republie pas).'
      )
      return
    }
    const link = data.data && data.data.link
    if (IS_REIMAGE) {
      progress.done('Images remplacées ✓', link)
      $('#progressMsg').textContent = 'Le nettoyage des anciennes images se termine en arrière-plan (~1 min).'
      resetReimageSession() // session entièrement réinitialisée (produit, image, rendus, clé)
    } else {
      progress.done('Produit publié ✓', link)
      // on retire les rendus publiés (nouvelle session propre)
      clearResults()
    }
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
  if (IS_REIMAGE) initReimageUi() // réordonne/renomme les cartes + verrouille l'upload
  await loadTemplates()
  loadSavedTemplates()
  if (!IS_REIMAGE) loadCollections() // pas de collection à choisir en mode reimage
  refreshAction()
})()
