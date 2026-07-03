/* ===== Mode « Créer un poster personnalisé » (/publisher/personalized) =====
   Chargé APRÈS app.js dans le MÊME scope global (scripts classiques : les const/let de
   premier niveau sont partagés) : accès direct à state, $, $$, toast, sleep, escapeHtml,
   refreshAction… app.js ne porte que les points de branchement (IS_PERSONALIZED) ; toute
   la logique du builder vit ici. Ce fichier ne fait RIEN hors mode personalized. */

// Base des assets de la page : '' en local (index.html à la racine du render server),
// '/publisher/' en prod (script servi à /publisher/personalized.js?v=…). Capturée au
// parse (document.currentScript est null plus tard).
const PERSONALIZED_ASSET_BASE = (() => {
  const src = (document.currentScript && document.currentScript.src) || ''
  if (!src) return ''
  const path = new URL(src, location.href).pathname
  return path.slice(0, path.lastIndexOf('/') + 1)
})()

// Slug technique du produit personnalisé (clé de routage back + ségrégation des stats)
const PERSONALIZED_PT_RE = /^[a-z][a-z0-9-]*$/
// Collection parente pré-suggérée : « Poster Personnalisé Famille » (modifiable)
const PERSONALIZED_DEFAULT_COLLECTION_GID = '624856400219'

// État du builder (config + recette). La config/recette chargées sont des COPIES profondes
// des presets : on ne mute jamais un preset en cache.
const pState = {
  configPresetId: null, // id du preset chargé (famille-lineart | champs-texte | photo-simple)
  config: null, // studio.config en cours d'édition
  recipe: null, // studio.recipe en cours d'édition
  productType: '', // slug saisi par Walid (JAMAIS pré-rempli depuis le preset : unique par produit)
}

/* ---------- UI : bascule de la page en mode personalized ---------- */
function initPersonalizedUi() {
  $('.brand em').textContent = 'Poster personnalisé'
  document.title = 'MyselfMonArt · Poster personnalisé'
  // cartes du builder visibles ; cartes existantes renumérotées (1 upload, 2 produit, 5-6 rendus)
  $('#studioCard').classList.remove('hidden')
  $('#recipeCard').classList.remove('hidden')
  $('#uploadCard .card-title').textContent = "1 · Votre design d'exemple"
  $('#mockupsCard .card-title').textContent = '5 · Mockups'
  $('#resultsCard .card-title').textContent = '6 · Vos rendus'
  // type produit verrouillé Poster : les autres boutons du segment sont masqués (pas de bascule)
  $$('#productType .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.type === 'poster')
    b.classList.toggle('hidden', b.dataset.type !== 'poster')
  })
  $('#publishBtn').textContent = 'Publier le produit personnalisé'
}

/* ---------- Presets (fichiers JSON copiés depuis le repo thème) ---------- */
async function fetchPersonalizedPreset(file) {
  const r = await fetch(PERSONALIZED_ASSET_BASE + 'presets/' + file)
  if (!r.ok) throw new Error('preset introuvable (' + r.status + ')')
  return await r.json()
}

async function loadConfigPreset(id) {
  const badge = $('#studioBadge')
  badge.textContent = 'chargement…'
  try {
    const preset = await fetchPersonalizedPreset(id + '.config.json')
    pState.configPresetId = id
    pState.config = JSON.parse(JSON.stringify(preset))
    // le slug du preset n'est JAMAIS repris (unique par produit — famille-lineart est déjà pris
    // par le produit live) : Walid saisit le sien, la config le recevra à la validation
    delete pState.config.productType
    renderStudioSteps()
    badge.textContent = `${pState.config.steps.length} étapes · preset chargé ✓`
    refreshAction()
  } catch (e) {
    pState.configPresetId = null
    pState.config = null
    renderStudioSteps()
    badge.textContent = 'erreur'
    toast('Preset : ' + e.message, 'err')
  }
}

async function loadRecipePreset() {
  const badge = $('#recipeBadge')
  badge.textContent = 'chargement…'
  try {
    const preset = await fetchPersonalizedPreset('famille-lineart.recipe.json')
    pState.recipe = JSON.parse(JSON.stringify(preset))
    renderRecipeSummary()
    badge.textContent = 'preset famille chargé ✓'
    refreshAction()
  } catch (e) {
    pState.recipe = null
    badge.textContent = 'erreur'
    toast('Recette : ' + e.message, 'err')
  }
}

/* ---------- Rendu (P1 : lecture seule — l'éditeur d'étapes arrive en P2) ---------- */
const STEP_TYPE_ICONS = { photo: '📷', text: '✏️', number: '🔢', date: '📅', format: '🖼', choice: '☑️', group: '🧩' }

function renderStudioSteps() {
  const wrap = $('#studioSteps')
  const empty = $('#studioEmpty')
  wrap.innerHTML = ''
  const steps = (pState.config && pState.config.steps) || []
  empty.classList.toggle('hidden', steps.length > 0)
  for (const step of steps) {
    const row = document.createElement('div')
    row.className = 'chosen' // pastille du design system (état sélectionné)
    row.style.marginTop = 'var(--s2)'
    const title = (step.title && step.title.fr) || ''
    row.innerHTML =
      `<span>${STEP_TYPE_ICONS[step.type] || '·'} ${escapeHtml(step.name)}</span>` +
      `<span class="chosen-info">${escapeHtml(step.type)}${title ? ' · ' + escapeHtml(title) : ''}</span>`
    wrap.appendChild(row)
  }
}

function renderRecipeSummary() {
  const wrap = $('#recipeForm')
  const empty = $('#recipeEmpty')
  wrap.innerHTML = ''
  empty.classList.toggle('hidden', !!pState.recipe)
  if (!pState.recipe) return
  const r = pState.recipe
  const bits = [
    ['Moteur', `${r.model || '—'} · ${r.aspect || '3:4'}`],
    ['Candidats / tentatives', `${r.candidates ?? '—'} / ${r.maxAttempts ?? '—'}`],
    ['Prompt', r.prompt && r.prompt.base ? 'base + ' + (Object.keys(r.prompt).filter((k) => k !== 'base' && r.prompt[k]).length) + ' fragments' : '⚠️ base manquante'],
    ['Juge', r.judge ? Object.entries(r.judge).filter(([, v]) => v).map(([k]) => k).join(' + ') || 'désactivé' : 'défauts back'],
  ]
  for (const [label, value] of bits) {
    const row = document.createElement('div')
    row.className = 'chosen'
    row.style.marginTop = 'var(--s2)'
    row.innerHTML = `<span>${escapeHtml(label)}</span><span class="chosen-info">${escapeHtml(value)}</span>`
    wrap.appendChild(row)
  }
}

/* ---------- Collection parente : pré-suggestion (modifiable) ---------- */
async function suggestDefaultCollection() {
  // loadCollections() (app.js) tourne en parallèle : on attend son résultat (borné à 10 s)
  for (let i = 0; i < 40 && !state.collections.length; i++) await sleep(250)
  if (state.collection || !state.collections.length) return
  const def = state.collections.find((c) => String(c.id).includes(PERSONALIZED_DEFAULT_COLLECTION_GID))
  if (!def) return
  state.collection = def
  collList.classList.add('hidden')
  collSearch.classList.add('hidden')
  collChosen.innerHTML = `<span>${escapeHtml(def.title)}</span><span class="x">✕</span>`
  collChosen.classList.remove('hidden')
  refreshAction()
}

/* ---------- Porte de publication + barre d'action ---------- */
// P1 : la publication reste verrouillée tant que le builder (P2) et la validation (P3) ne sont
// pas livrés. La porte deviendra : config valide (validateur thème + 5 langues + consent) ET
// recette valide (clamps + prompt.base) ET slug unique.
function personalizedPublishGate() {
  const missing = []
  if (!pState.config) missing.push('config (choisir un preset)')
  if (!pState.recipe) missing.push('recette')
  if (!PERSONALIZED_PT_RE.test(pState.productType)) missing.push('slug produit')
  return {
    ok: false,
    hint: missing.length ? 'Manque : ' + missing.join(' · ') : 'Builder en construction — publication bientôt disponible',
  }
}

function refreshActionPersonalized() {
  const info = $('#actionInfo'),
    btn = $('#publishBtn')
  const n = state.results.length
  if (state.needsResize) {
    info.textContent = "⚠️ Retaille l'image au bon format pour publier"
    btn.disabled = true
    return
  }
  const gate = personalizedPublishGate()
  const parts = []
  if (state.collection) parts.push(state.collection.title)
  parts.push(`${n} rendu${n > 1 ? 's' : ''}`)
  parts.push(gate.hint)
  info.textContent = parts.join(' · ')
  btn.disabled = !(gate.ok && state.collection && n > 0 && state.imageDataUrl)
}

/* ---------- Payload publish (bloc `personalized`) ---------- */
function buildPersonalizedPublishBlock() {
  // P4 : bloc complet (config finalisée + slug, recette, templateSuffix, référence de style,
  // exemples photo en base64, shortTitle). Inatteignable tant que personalizedPublishGate()
  // renvoie ok:false — présent dès maintenant pour figer le contrat côté app.js.
  return {
    studioConfig: pState.config ? { ...pState.config, productType: pState.productType } : null,
    studioRecipe: pState.recipe,
  }
}

/* ---------- Init (auto — uniquement en mode personalized) ---------- */
if (IS_PERSONALIZED) {
  window.PersonalizedMode = {
    refreshAction: refreshActionPersonalized,
    buildPublishBlock: buildPersonalizedPublishBlock,
  }
  initPersonalizedUi()
  loadRecipePreset()
  suggestDefaultCollection()
  $('#studioPreset').addEventListener('change', (e) => {
    if (e.target.value) loadConfigPreset(e.target.value)
  })
  $('#studioProductType').addEventListener('input', (e) => {
    pState.productType = e.target.value.trim()
    const hint = $('#studioProductTypeHint')
    const bad = pState.productType && !PERSONALIZED_PT_RE.test(pState.productType)
    hint.style.color = bad ? 'var(--danger)' : ''
    hint.textContent = bad
      ? 'Slug invalide : minuscules, chiffres et tirets, commence par une lettre (ex : couple-aquarelle).'
      : "Unique par produit — minuscules/chiffres/tirets. C'est la clé de routage back-end et de ségrégation des statistiques."
    refreshAction()
  })
  refreshActionPersonalized()
}
