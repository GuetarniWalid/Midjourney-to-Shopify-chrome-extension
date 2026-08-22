/* ===== Mode « Créer un poster personnalisé » (/publisher/personalized) =====
   Chargé APRÈS app.js + lib/validate-studio-config.js dans le MÊME scope global (scripts
   classiques : les const/let de premier niveau sont partagés) : accès direct à state, $, $$,
   toast, sleep, escapeHtml, refreshAction, collList/collSearch/collChosen… app.js ne porte que
   les points de branchement (IS_PERSONALIZED) ; toute la logique du builder vit ici.
   Ce fichier ne fait RIEN hors mode personalized. */

// Base des assets de la page : '' en local (index.html à la racine du render server),
// '/publisher/' en prod. Capturée au parse (document.currentScript est null plus tard).
const PERSONALIZED_ASSET_BASE = (() => {
  const src = (document.currentScript && document.currentScript.src) || ''
  if (!src) return ''
  const path = new URL(src, location.href).pathname
  return path.slice(0, path.lastIndexOf('/') + 1)
})()

// Collection parente pré-suggérée : « Poster Personnalisé Famille » (modifiable)
const PERSONALIZED_DEFAULT_COLLECTION_GID = '624856400219'
// Langues du studio (l'ordre compte : FR d'abord)
const STUDIO_LANGS = ['fr', 'en', 'de', 'nl', 'es']
// Types proposés à l'ajout (UNIQUEMENT ce que le moteur rend — cf. plan §4.2)
const STEP_TYPE_META = {
  photo: { icon: '📷', label: 'Photo', desc: 'Upload d’une photo + juge photo (max 1)' },
  text: { icon: '✏️', label: 'Texte', desc: 'Champ texte libre (prénom, nom…)' },
  number: { icon: '🔢', label: 'Nombre', desc: 'Champ numérique entier' },
  date: { icon: '📅', label: 'Date', desc: 'Sélecteur de date ou d’heure' },
  format: { icon: '🖼', label: 'Format', desc: 'Taille + cadre (obligatoire, en dernier)' },
  choice: { icon: '☑️', label: 'Choix', desc: 'non rendu par le moteur' },
  group: { icon: '🧩', label: 'Groupe', desc: 'non rendu par le moteur' },
}
// Angles de la photoPolicy (contrat §9.2)
const PHOTO_ANGLES = [
  { key: 'front', fr: 'Face' },
  { key: 'three-quarter', fr: 'Trois-quarts' },
  { key: 'profile', fr: 'Profil' },
  { key: 'back', fr: 'Dos' },
]
const PHOTO_GRADES = [
  { key: 'perfect', icon: '🟢', fr: 'Parfait' },
  { key: 'warn', icon: '🟡', fr: 'Accepté' },
  { key: 'reject', icon: '🔴', fr: 'Refusé' },
]
// Angle retenu -> libellé court, affiché SUR la ligne de l'étape photo (c'est le réglage que
// Walid doit relire en priorité : une photo au mauvais angle rate le tableau).
const ANGLE_SHORT_FR = { front: 'de face', 'three-quarter': 'de trois-quarts', profile: 'de profil', back: 'de dos' }
// Politique photo neutre : rien de bloquant, aucun angle imposé. Sert de socle quand une étape
// photo arrive du catalogue (qui n'en porte pas) — l'analyse du design la remplit ensuite.
const blankPhotoPolicy = () => ({ subject: 'person', framing: 'full-body', angles: {}, messages: {} })
// Angle 🟢 d'une étape photo (null si la grille n'en désigne aucun).
// Légende de la BONNE photo telle que le CLIENT la lira en boutique : elle vient du thème
// (locales fr.default.json, clés photo_caption_*) et suit `faceAngle`. On la recopie ici pour que
// l'aperçu montre le vrai texte — il affichait le `alt` (invisible en boutique), d'où des
// légendes qui ne collaient pas à l'angle demandé.
const THEME_GOOD_CAPTION_FR = {
  front: 'Photo idéale : visage net, bien éclairé, de face',
  'three-quarter': 'Photo idéale : visage net, bien éclairé, légèrement de trois-quarts',
  profile: 'Photo idéale : visage net, bien éclairé, de profil',
  back: 'Photo idéale : prise de dos, en pied, silhouettes nettes et bien éclairées',
}
const perfectAngleOf = (step) => {
  const angles = (step && step.photoPolicy && step.photoPolicy.angles) || {}
  const hit = Object.entries(angles).find(([, g]) => g === 'perfect')
  return hit ? hit[0] : null
}


/* ---------- Catalogue d'étapes PRÊTES À L'EMPLOI ----------
   Jamais de type générique : chaque entrée est une étape CONCRÈTE, entièrement préremplie et
   déjà traduite en 5 langues — l'ajout ne demande AUCUNE saisie (modifiable ensuite via ✎). */
const STEP_CATALOG = [
  {
    id: 'photo', icon: '📷', label: 'Photo',
    step: {
      name: 'photo', type: 'photo', required: true, consent: { required: true }, payloadKey: 'photo',
      title: { fr: 'Votre photo', en: 'Your photo', de: 'Dein Foto', nl: 'Je foto', es: 'Tu foto' },
      checkpointLabel: { fr: 'Photo', en: 'Photo', de: 'Foto', nl: 'Foto', es: 'Foto' },
      faceAngle: 'front', photoCheck: false,
    },
  },
  {
    id: 'familyName', icon: '✏️', label: 'Nom de famille',
    step: {
      name: 'familyName', type: 'text', required: true, maxLength: 24, charset: 'free', payloadKey: 'familyName',
      cartProperty: { label: { fr: 'Nom de famille', en: 'Family name', de: 'Familienname', nl: 'Familienaam', es: 'Apellido' } },
      title: { fr: 'Votre nom de famille', en: 'Your family name', de: 'Dein Familienname', nl: 'Je familienaam', es: 'Tu apellido' },
      label: { fr: 'Nom affiché sur le poster', en: 'Name shown on the poster', de: 'Name auf dem Poster', nl: 'Naam op de poster', es: 'Nombre mostrado en el póster' },
      placeholder: { fr: 'Ex : Guetarni', en: 'E.g. Guetarni', de: 'z. B. Guetarni', nl: 'Bijv. Guetarni', es: 'Ej.: Guetarni' },
      checkpointLabel: { fr: 'Nom', en: 'Name', de: 'Name', nl: 'Naam', es: 'Apellido' },
    },
  },
  {
    id: 'firstName', icon: '✏️', label: 'Prénom',
    step: {
      name: 'firstName', type: 'text', required: true, maxLength: 20, charset: 'letters', transform: 'uppercase', payloadKey: 'firstName',
      cartProperty: { label: { fr: 'Prénom', en: 'First name', de: 'Vorname', nl: 'Voornaam', es: 'Nombre' } },
      title: { fr: 'Votre prénom', en: 'Your first name', de: 'Dein Vorname', nl: 'Je voornaam', es: 'Tu nombre' },
      checkpointLabel: { fr: 'Prénom', en: 'Name', de: 'Name', nl: 'Naam', es: 'Nombre' },
      label: { fr: 'Prénom à afficher', en: 'Name to display', de: 'Anzuzeigender Name', nl: 'Weer te geven naam', es: 'Nombre a mostrar' },
      placeholder: { fr: 'Ex : Lina', en: 'E.g. Lina', de: 'z. B. Lina', nl: 'Bijv. Lina', es: 'Ej.: Lina' },
    },
  },
  {
    id: 'memberNames', icon: '✏️', label: 'Prénoms (plusieurs)',
    step: {
      name: 'memberNames', type: 'text', required: true, maxLength: 140, charset: 'free', payloadKey: 'names',
      cartProperty: { label: { fr: 'Prénoms', en: 'First names', de: 'Vornamen', nl: 'Voornamen', es: 'Nombres' } },
      title: { fr: "Les prénoms, dans l'ordre", en: 'The names, in order', de: 'Die Vornamen, in der Reihenfolge', nl: 'De voornamen, op volgorde', es: 'Los nombres, en orden' },
      label: { fr: 'Prénoms de gauche à droite, séparés par des virgules', en: 'Names left to right, separated by commas', de: 'Vornamen von links nach rechts, durch Kommas getrennt', nl: "Voornamen van links naar rechts, gescheiden door komma's", es: 'Nombres de izquierda a derecha, separados por comas' },
      placeholder: { fr: 'Ex : Papa, Franco, Maman, Veronica', en: 'E.g. Daddy, Franco, Mommy, Veronica', de: 'z. B. Papa, Franco, Mama, Veronica', nl: 'Bijv. Papa, Franco, Mama, Veronica', es: 'Ej.: Papá, Franco, Mamá, Veronica' },
      help: { fr: 'Dans le même ordre que sur votre photo (de gauche à droite).', en: 'Same order as on your photo (left to right).', de: 'In derselben Reihenfolge wie auf deinem Foto (von links nach rechts).', nl: 'In dezelfde volgorde als op je foto (van links naar rechts).', es: 'En el mismo orden que en tu foto (de izquierda a derecha).' },
      checkpointLabel: { fr: 'Prénoms', en: 'Names', de: 'Namen', nl: 'Namen', es: 'Nombres' },
    },
  },
  {
    id: 'birthDate', icon: '📅', label: 'Date de naissance',
    step: {
      name: 'birthDate', type: 'date', mode: 'date', required: true, payloadKey: 'birthDate',
      cartProperty: { label: { fr: 'Date de naissance', en: 'Date of birth', de: 'Geburtsdatum', nl: 'Geboortedatum', es: 'Fecha de nacimiento' } },
      title: { fr: 'La date de naissance', en: 'The date of birth', de: 'Das Geburtsdatum', nl: 'De geboortedatum', es: 'La fecha de nacimiento' },
      checkpointLabel: { fr: 'Naissance', en: 'Birth', de: 'Geburt', nl: 'Geboorte', es: 'Nacimiento' },
      label: { fr: 'Date affichée sur le poster', en: 'Date shown on the poster', de: 'Datum auf dem Poster', nl: 'Datum op de poster', es: 'Fecha mostrada en el póster' },
      help: { fr: "La date de naissance à écrire sur l'affiche.", en: 'The date of birth to write on the print.', de: 'Das Geburtsdatum, das auf das Poster geschrieben wird.', nl: 'De geboortedatum die op de poster komt.', es: 'La fecha de nacimiento que se escribirá en el póster.' },
    },
  },
  {
    id: 'weddingDate', icon: '📅', label: 'Date de mariage',
    step: {
      name: 'weddingDate', type: 'date', mode: 'date', required: true, payloadKey: 'weddingDate',
      cartProperty: { label: { fr: 'Date du mariage', en: 'Wedding date', de: 'Hochzeitsdatum', nl: 'Trouwdatum', es: 'Fecha de la boda' } },
      title: { fr: 'La date du mariage', en: 'The wedding date', de: 'Das Hochzeitsdatum', nl: 'De trouwdatum', es: 'La fecha de la boda' },
      checkpointLabel: { fr: 'Mariage', en: 'Wedding', de: 'Hochzeit', nl: 'Bruiloft', es: 'Boda' },
      label: { fr: 'Date affichée sur le poster', en: 'Date shown on the poster', de: 'Datum auf dem Poster', nl: 'Datum op de poster', es: 'Fecha mostrada en el póster' },
      help: { fr: "La date du mariage à écrire sur l'affiche.", en: 'The wedding date to write on the print.', de: 'Das Hochzeitsdatum, das auf das Poster geschrieben wird.', nl: 'De trouwdatum die op de poster komt.', es: 'La fecha de la boda que se escribirá en el póster.' },
    },
  },
  {
    id: 'personalMessage', icon: '✏️', label: 'Message personnel',
    step: {
      name: 'personalMessage', type: 'text', required: true, maxLength: 90, charset: 'free', payloadKey: 'personalMessage',
      cartProperty: { label: { fr: 'Message', en: 'Message', de: 'Botschaft', nl: 'Boodschap', es: 'Mensaje' } },
      title: { fr: 'Votre message personnel', en: 'Your personal message', de: 'Deine persönliche Botschaft', nl: 'Je persoonlijke boodschap', es: 'Tu mensaje personal' },
      checkpointLabel: { fr: 'Message', en: 'Message', de: 'Botschaft', nl: 'Boodschap', es: 'Mensaje' },
      label: { fr: 'Message affiché sur le poster', en: 'Message shown on the poster', de: 'Botschaft auf dem Poster', nl: 'Boodschap op de poster', es: 'Mensaje mostrado en el póster' },
      placeholder: { fr: 'Ex : Pour toujours et à jamais', en: 'E.g. Forever and always', de: 'z. B. Für immer und ewig', nl: 'Bijv. Voor altijd en eeuwig', es: 'Ej.: Por siempre jamás' },
    },
  },
]

// État du builder. config/recipe = COPIES profondes des presets (jamais muter un preset en cache).
const pState = {
  configPresetId: null,
  config: null,
  recipe: null,
  // (pas de productType ici : le nom de code est généré par le back à la publication)
  photoExamples: { good: null, bad: null }, // base64 en attente (URL CDN posée au publish P4)
  recipeSameAsDesign: true, // le design (carte 1) sert d'image de référence de style
  styleRef: null, // base64 de la référence de style si ≠ design (URL CDN posée au publish P4)
  previewStepName: null,
  // Animaux lus sur le design par l'analyse (« chien ») : transmis au generateur d'exemples,
  // sinon il photographie la personne SEULE alors que l'oeuvre montre son animal.
  planAnimals: [],
  editing: null, // { index, working } pendant l'édition d'une étape
}
// Ratio de la recette DÉDUIT de l'image (carte 1), comme partout dans l'app :
// portrait -> 3:4, paysage -> 4:3, carré -> 1:1 (pas d'image encore = 3:4, le cas nominal poster).
const recipeAspectFromImage = () =>
  state.orientation === 'landscape' ? '4:3' : state.orientation === 'square' ? '1:1' : '3:4'
// Fragments avancés relisibles. imageRoles/countLine n'y sont PLUS : structurels, identiques
// pour tous les produits — imposés en code par le backend à la publication.
const RECIPE_ADVANCED = [
  { key: 'replaceTitle', label: 'Remplacement du titre ({from} → {to})' },
  { key: 'addExtra', label: 'Ajouter une personne ({to})' },
  { key: 'removeExtra', label: 'Retirer une personne ({from})' },
]

/* ---------- Helpers i18n ---------- */
const t = (map, lang) => (map && typeof map === 'object' ? map[lang] || map.fr || '' : typeof map === 'string' ? map : '')
// Lecture seule : map i18n présente à ce chemin (sans rien créer), sinon null.
function getI18nMap(root, dotPath) {
  const parts = dotPath.split('.')
  let node = root
  for (const p of parts) {
    if (!node || typeof node !== 'object') return null
    node = node[p]
  }
  return node && typeof node === 'object' && !Array.isArray(node) ? node : null
}
// Toutes les maps i18n PRÉSENTES d'une étape (lecture seule, pour validation/traduction).
function existingI18nMaps(step) {
  const out = []
  const consider = [
    'title', 'checkpointLabel', 'label', 'placeholder', 'help', 'cartProperty.label',
    'examples.good.alt', 'examples.bad.alt', 'examples.bad.caption',
    'photoPolicy.messages.warn_angle', 'photoPolicy.messages.reject_framing',
    'photoPolicy.messages.angle_mismatch',
  ]
  for (const path of consider) {
    const map = getI18nMap(step, path)
    if (map) out.push({ path: `${step.name}.${path}`, map })
  }
  return out
}

/* ---------- UI : bascule de la page en mode personalized ---------- */
function initPersonalizedUi() {
  $('.brand em').textContent = 'Poster personnalisé'
  document.title = 'MyselfMonArt · Poster personnalisé'
  $('#studioCard').classList.remove('hidden')
  $('#recipeCard').classList.remove('hidden')
  $('#uploadCard .card-title').textContent = "1 · Votre design d'exemple"
  $('#mockupsCard .card-title').textContent = '5 · Mockups'
  $('#resultsCard .card-title').textContent = '6 · Vos rendus'
  $$('#productType .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.type === 'poster')
    b.classList.toggle('hidden', b.dataset.type !== 'poster')
  })
  $('#publishBtn').textContent = 'Publier le produit personnalisé'
}

/* ---------- Presets ---------- */
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
    // le slug du preset n'est JAMAIS repris (unique par produit) : Walid saisit le sien
    delete pState.config.productType
    // Changer de preset = repartir de zéro : on oublie les exemples photo et la référence de style
    // uploadés pour le preset PRÉCÉDENT (sinon ils fuiraient dans un preset sans étape photo ->
    // fichiers Shopify orphelins à la publication).
    pState.photoExamples = { good: null, bad: null }
    pState.styleRef = null
    pState.recipeSameAsDesign = true
    pState.previewStepName = pState.config.steps[0] && pState.config.steps[0].name
    onConfigChanged()
    $('#studioAddStep').classList.remove('hidden')
    $('#studioPreviewWrap').classList.remove('hidden')
  } catch (e) {
    pState.configPresetId = null
    pState.config = null
    onConfigChanged()
    badge.textContent = 'erreur'
    $('#studioEmpty').textContent = 'Impossible de charger le parcours client — recharge la page.'
    toast('Parcours : ' + e.message, 'err')
  }
}
async function loadRecipePreset() {
  const badge = $('#recipeBadge')
  badge.textContent = 'chargement…'
  try {
    const preset = await fetchPersonalizedPreset('famille-lineart.recipe.json')
    pState.recipe = JSON.parse(JSON.stringify(preset))
    renderRecipeForm()
    refreshAction()
  } catch (e) {
    pState.recipe = null
    badge.textContent = 'erreur'
    toast('Recette : ' + e.message, 'err')
  }
}

/* ---------- Validation (validateur thème + règles builder) ---------- */
function validatePersonalizedConfig() {
  const byStep = new Map()
  const rootErrors = []
  let warnings = []
  const cfg = pState.config
  if (!cfg) return { ok: false, byStep, rootErrors: ['Aucun preset chargé.'], warnings }

  // 1) validateur thème (contrat moteur) — attribution des erreurs à leur étape
  const base = window.StudioValidator.validateConfig(cfg)
  warnings = base.warnings.slice()
  for (const msg of base.errors) {
    const m = msg.match(/step "([^"]+)"/)
    if (m) (byStep.get(m[1]) || byStep.set(m[1], []).get(m[1])).push(msg)
    else rootErrors.push(msg)
  }

  // 2) règle builder : le FRANÇAIS suffit ici — les 4 autres langues sont générées
  // automatiquement par le backend à la publication (une seule vérité : le FR de Walid).
  for (const step of cfg.steps || []) {
    for (const { path, map } of existingI18nMaps(step)) {
      if (!(typeof map.fr === 'string' && map.fr.trim()))
        (byStep.get(step.name) || byStep.set(step.name, []).get(step.name)).push(
          `${path} : le texte français est vide.`
        )
    }
  }

  // 3) consent : une étape photo impose payload.extra.consent = "1"
  const hasPhoto = (cfg.steps || []).some((s) => s.type === 'photo')
  if (hasPhoto && !(cfg.payload && cfg.payload.extra && cfg.payload.extra.consent === '1'))
    rootErrors.push('payload.extra.consent = "1" obligatoire dès qu’une étape photo existe (consentement).')

  // (le nom de code productType n'est plus saisi ici : généré par le back à la publication)

  const stepErrCount = [...byStep.values()].reduce((n, a) => n + a.length, 0)
  return { ok: rootErrors.length === 0 && stepErrCount === 0, byStep, rootErrors, warnings }
}

/* ---------- Rendu : liste des étapes ---------- */
function renderStudioSteps() {
  const wrap = $('#studioSteps')
  const empty = $('#studioEmpty')
  wrap.innerHTML = ''
  const steps = (pState.config && pState.config.steps) || []
  empty.classList.toggle('hidden', steps.length > 0)
  if (!steps.length) return
  const v = validatePersonalizedConfig()
  const photoCount = steps.filter((s) => s.type === 'photo').length
  steps.forEach((step, i) => {
    // L'étape « format » n'est PAS montrée : rien à y décider (tailles/cadres = variantes créées
    // par le back à la publication, libellés standards identiques pour tous). Elle reste dans le
    // JSON — le contrat du thème l'exige — et le client la verra (cf. aperçu du parcours).
    if (step.type === 'format') return
    const errs = v.byStep.get(step.name) || []
    const meta = STEP_TYPE_META[step.type] || { icon: '·' }
    const cell = document.createElement('div')
    cell.className = 'studio-step'
    cell.dataset.name = step.name
    // Sur la photo, l'angle exigé est affiché À CÔTÉ du nom : c'est LE réglage qui décide si le
    // tableau ressemblera au client, et le seul qu'on ne peut pas deviner sans ouvrir l'éditeur.
    // Sauf quand le titre le dit déjà (« Votre photo de dos ») — répéter n'informe pas.
    let angle = step.type === 'photo' ? perfectAngleOf(step) : null
    // (les 4 libellés d'angle sont sans accent : une comparaison en minuscules suffit)
    const angleShort = angle ? ANGLE_SHORT_FR[angle] : null
    if (angleShort && (t(step.title, 'fr') || '').toLowerCase().includes(angleShort)) angle = null
    cell.innerHTML =
      `<span class="ss-icon">${meta.icon}</span>` +
      `<span class="ss-main"><span class="ss-name">${escapeHtml(t(step.title, 'fr') || step.name)}` +
      (angle ? ` <span class="ss-tag">${escapeHtml(ANGLE_SHORT_FR[angle] || angle)}</span>` : '') +
      `</span></span>` +
      `<span class="ss-badge ${errs.length ? 'err' : 'ok'}">${errs.length ? '✗ ' + errs.length : '✓'}</span>` +
      `<span class="ss-actions">` +
      (step.type === 'photo' ? `<button class="ss-act ss-edit" title="Régler la photo">✎</button>` : '') +
      `<button class="ss-act danger ss-del" title="Supprimer">🗑</button>` +
      `</span>`
    const editBtn = cell.querySelector('.ss-edit')
    if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openStepEditor(i) })
    cell.querySelector('.ss-del').addEventListener('click', (e) => { e.stopPropagation(); deleteStep(i) })
    attachStepDrag(cell)
    wrap.appendChild(cell)
  })
  // photo max 1 : grise le choix photo dans l'ajout (géré à l'ouverture du picker)
  $('#studioAddStep').dataset.photoFull = photoCount >= 1 ? '1' : ''
}

/* ---------- Rendu : erreurs de validation ----------
   Règle UX : quand tout est valide, on n'affiche RIEN (pas de bandeau vert, pas de badge) —
   seules les ERREURS apparaissent, car elles seules demandent une action. */
function renderStudioValidation() {
  const box = $('#studioValidation')
  const badge = $('#studioBadge')
  if (!pState.config) { box.className = 'studio-validation hidden'; badge.textContent = ''; return }
  const v = validatePersonalizedConfig()
  const stepErrs = [...v.byStep.values()].reduce((n, a) => n + a.length, 0)
  if (v.ok) {
    box.className = 'studio-validation hidden'
    box.innerHTML = ''
    badge.textContent = ''
  } else {
    box.className = 'studio-validation err'
    const items = [...v.rootErrors]
    for (const [name, errs] of v.byStep) for (const e of errs) items.push(`« ${name} » — ${e.replace(/^step "[^"]+"\.?/, '')}`)
    box.innerHTML = `✗ ${v.rootErrors.length + stepErrs} erreur(s) à corriger avant publication :` +
      `<ul>${items.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` +
      (items.length > 12 ? `<div>… et ${items.length - 12} autre(s).</div>` : '')
    badge.textContent = `${stepErrs + v.rootErrors.length} erreur(s)`
  }
  renderAnalysisState() // l'analyse en cours (ou son échec) reprend le badge
}

/* ---------- Éditeur de recette (studio.recipe) ---------- */
// Écrit une valeur à un chemin `a.b.c` de pState.recipe (crée les niveaux au besoin).
function setRecipePath(path, value) {
  const parts = path.split('.')
  let node = pState.recipe
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {}
    node = node[parts[i]]
  }
  node[parts[parts.length - 1]] = value
}
const getRecipePath = (path) => path.split('.').reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), pState.recipe)
// Étapes de config utilisables comme entrées de recette (non-format, avec payloadKey/name).
function configInputSteps() {
  const steps = (pState.config && pState.config.steps) || []
  return steps.filter((s) => s.type !== 'format').map((s) => ({ key: s.payloadKey || s.name, name: s.name, type: s.type }))
}
// Mapping AUTOMATIQUE des prénoms (inputs.tokens) depuis les étapes — aucune décision humaine :
// l'étape « Prénoms (liste) » (memberNames*) est la source ; à défaut « Prénom » (firstName*) ;
// sans étape prénoms, pas de tokens. Le max suit « Personnes max » du juge photo. Un tokens.from
// encore valide (préréglage famille) est conservé ; un renommage/suppression d'étape se répare seul.
function syncRecipeTokens(r) {
  const steps = (pState.config && pState.config.steps) || []
  const keyOf = (s) => s.payloadKey || s.name
  const textSteps = steps.filter((s) => s.type === 'text')
  const current = r.inputs && r.inputs.tokens && r.inputs.tokens.from
  const currentOk = current && steps.some((s) => s.type !== 'format' && keyOf(s) === current)
  const multi = textSteps.find((s) => /^memberNames/.test(s.name))
  const single = textSteps.find((s) => /^firstName/.test(s.name))
  const from = currentOk ? current : multi ? keyOf(multi) : single ? keyOf(single) : null
  if (!from) {
    if (r.inputs) delete r.inputs.tokens
    return null
  }
  const photo = steps.find((s) => s.type === 'photo')
  const pol = (photo && photo.photoPolicy) || null
  const pm = pol && pol.people && pol.people.max
  // Sujet solo (le design ne montre qu'une figure) : une seule légende a du sens — sans cette
  // borne, le client pourrait saisir 4 prénoms et le rendu devrait dessiner 4 personnes.
  const max = typeof pm === 'number' ? pm : pol && pol.subject === 'person' ? 1 : (r.inputs.tokens && r.inputs.tokens.max) || 6
  r.inputs.tokens = { from, split: true, max }
  return r.inputs.tokens
}
// Même auto-réparation pour le TITRE. Le préréglage porte « La famille {familyName} » : si le
// parcours ne contient plus l'étape citée (l'analyse du design ne la retient pas toujours), le
// titre est PENDANT et le serveur refuse la publication — « Le champ « {familyName} » du titre ne
// correspond à aucune étape ». On le retire alors, avec son texte source : DesignTextReader lit le
// vrai titre SUR LE DESIGN à la publication (titre variable -> template ; titre décoratif fixe
// comme « Dog Mom » -> écrit tel quel). Les deux partent ENSEMBLE : le contrat de la recette
// refuse un inputs.title sans reference.texts.title (substitution impossible).
function syncRecipeTitle(r) {
  const title = r.inputs && r.inputs.title
  if (!title || typeof title.template !== 'string') return
  const keys = new Set(configInputSteps().map((s) => s.key))
  const used = (title.template.match(/\{([^{}]+)\}/g) || []).map((m) => m.slice(1, -1))
  if (used.every((k) => keys.has(k))) return // titre fixe (aucun champ) ou champs tous présents
  delete r.inputs.title
  if (r.reference && r.reference.texts) delete r.reference.texts.title
}
function renderRecipeForm() {
  const wrap = $('#recipeForm')
  const empty = $('#recipeEmpty')
  empty.classList.toggle('hidden', !!pState.recipe)
  $('#recipeVerify').classList.toggle('hidden', !pState.recipe)
  if (!pState.recipe) { wrap.innerHTML = ''; return }
  const r = pState.recipe
  r.inputs = r.inputs || {}
  r.reference = r.reference || { texts: {} }
  r.reference.texts = r.reference.texts || {}
  r.prompt = r.prompt || {}
  const P = []

  // Moteur : PAS d'UI — mêmes réglages pour tous les produits. Le ratio est déduit de l'image
  // (carte 1) ; modèle/versions/essais gardent les défauts du preset (gemini-3-pro-image, 3, 2).
  r.aspect = recipeAspectFromImage()

  // Entrées : mapping 100 % AUTOMATIQUE et SILENCIEUX — prénoms depuis les étapes, max depuis
  // le juge photo. La table de remplacement des textes (titre écrit sur le design, légendes par
  // sujet, template du titre) est LUE SUR LE DESIGN par le backend à la publication (vision) :
  // plus aucun champ ici — les valeurs du préréglage restent en secours dans le JSON.
  const tokens = syncRecipeTokens(r)
  syncRecipeTitle(r)

  // Contrôle qualité : TOUJOURS actif (imposé, plus d'UI) — sauf le comptage de personnages,
  // qui se règle sur le nombre de légendes attendues. Sans légendes par sujet, le compte
  // attendu vaut 0 et le contrôle recalerait tous les rendus : il n'a alors pas d'objet.
  // (Le back retranche la même règle à la publication, sur la table réellement lue du design.)
  r.judge = { text: true, figureCount: !!tokens }

  // Référence de style : seul vrai choix — le design (défaut) ou une autre image.
  P.push('<div class="studio-sub"><p class="studio-sub-title">Référence de style</p>')
  P.push(`<label class="studio-check"><input type="checkbox" id="rf-sameAsDesign" ${pState.recipeSameAsDesign ? 'checked' : ''}> Le design d’exemple (carte 1) EST la référence</label>`)
  P.push(`<div id="rf-upload" class="${pState.recipeSameAsDesign ? 'hidden' : ''}">
    ${fieldBlock('Image de référence', '', `<input type="file" accept="image/*" id="rf-styleRef" class="decor-vibe">`)}
    <div class="photo-ex-slot"><img id="rf-styleRef-img" src="${pState.styleRef || ''}" alt="" ${pState.styleRef ? '' : 'style="min-height:80px"'}></div>
  </div>`)
  P.push('</div>')

  // Modèle d'image : le SEUL réglage moteur exposé. Il existe parce que certains styles passent
  // mal chez un fournisseur et bien chez l'autre — le reste (versions, essais) garde ses défauts.
  const modelChoice = recipeModelChoice(r)
  P.push('<div class="studio-sub"><p class="studio-sub-title">Modèle d’image</p>')
  P.push(fieldBlock(
    '',
    'Sert au rendu d’essai ET aux vraies commandes. Ce modèle sera le seul utilisé : en cas d’échec, la commande part en revue plutôt que de rendre un autre style.',
    `<select id="rf-model" class="decor-vibe">${RECIPE_MODELS.map((m) =>
      `<option value="${m.id}"${m.id === modelChoice ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    ).join('')}</select>`
  ))
  P.push('</div>')

  // Prompt
  P.push('<div class="studio-sub"><p class="studio-sub-title">Prompt (en anglais — Gemini suit mieux l’anglais)</p>')
  P.push(fieldBlock('Base (obligatoire)', '', `<textarea data-recipe="prompt.base" style="min-height:120px">${escapeHtml(r.prompt.base || '')}</textarea>`))
  P.push(fieldBlock('Par personne (perPerson)', '', `<textarea data-recipe="prompt.perPerson">${escapeHtml(r.prompt.perPerson || '')}</textarea>`))
  P.push(fieldBlock('Pied (footer)', '', `<textarea data-recipe="prompt.footer">${escapeHtml(r.prompt.footer || '')}</textarea>`))
  P.push(`<button type="button" class="i18n-toggle" id="rf-adv-toggle">▾ Fragments avancés</button><div id="rf-advanced" class="hidden">`)
  for (const f of RECIPE_ADVANCED)
    P.push(fieldBlock(f.label, '', `<textarea data-recipe="prompt.${f.key}">${escapeHtml(r.prompt[f.key] || '')}</textarea>`))
  P.push('</div></div>')

  // (contrôle qualité : plus d'UI — toujours actif, cf. r.judge imposé plus haut)

  wrap.innerHTML = P.join('')
  wireRecipeEvents()
  renderRecipeValidation()
  renderRecipeTest()
}
function wireRecipeEvents() {
  const model = $('#rf-model')
  if (model) model.addEventListener('change', () => {
    setRecipeModelChoice(pState.recipe, model.value)
    renderRecipeValidation()
  })
  // champs simples liés à un chemin
  $$('#recipeForm [data-recipe]').forEach((el) =>
    el.addEventListener('input', () => {
      const path = el.dataset.recipe
      let v = el.value
      if (path === 'candidates' || path === 'maxAttempts') v = parseInt(v, 10) || 0
      setRecipePath(path, v)
      renderRecipeValidation()
      refreshAction()
    })
  )
  // (inputs.tokens, inputs.title, reference.texts.* : plus aucune UI — tokens synchronisés
  // depuis les étapes, titre/slots lus sur le design par le backend à la publication)
  // référence = design ?
  const same = $('#rf-sameAsDesign')
  if (same) same.addEventListener('change', () => {
    pState.recipeSameAsDesign = same.checked
    $('#rf-upload').classList.toggle('hidden', same.checked)
    renderRecipeValidation(); refreshAction()
  })
  const refFile = $('#rf-styleRef')
  if (refFile) refFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]
    if (!f || !f.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => { pState.styleRef = reader.result; $('#rf-styleRef-img').src = reader.result; renderRecipeValidation(); refreshAction() }
    reader.readAsDataURL(f)
  })
  // avancé
  const advT = $('#rf-adv-toggle')
  if (advT) advT.addEventListener('click', () => {
    const adv = $('#rf-advanced')
    const hidden = adv.classList.toggle('hidden')
    advT.textContent = hidden ? '▾ Fragments avancés' : '▴ Masquer les fragments avancés'
  })
}
// Validation recette côté client (règles simples ; le back re-valide via RecipeService).
function validateRecipeClient() {
  const errs = []
  const r = pState.recipe
  if (!r) return ['Recette non chargée.']
  // auto-réparation AVANT contrôle : le mapping des prénoms suit toujours les étapes courantes
  if (r.inputs) { syncRecipeTokens(r); syncRecipeTitle(r) }
  if (!(r.prompt && r.prompt.base && r.prompt.base.trim())) errs.push('prompt.base est obligatoire.')
  const c = r.candidates
  if (!(Number.isInteger(c) && c >= 1 && c <= 4)) errs.push('candidates doit être entre 1 et 4.')
  const m = r.maxAttempts
  if (!(Number.isInteger(m) && m >= 1 && m <= 3)) errs.push('maxAttempts doit être entre 1 et 3.')
  if (r.inputs && r.inputs.tokens) {
    const tm = r.inputs.tokens.max
    if (!(Number.isInteger(tm) && tm >= 1 && tm <= 8)) errs.push('tokens.max doit être entre 1 et 8.')
  }
  // (titre/slots/template : plus de règles ici — la table de remplacement est écrite par le
  // backend à la publication, cohérente par construction avec le design et les étapes)
  // cohérence recette ↔ config (clés d'entrée = payloadKey des étapes non-format)
  if (pState.config) {
    const inputKeys = new Set(configInputSteps().map((s) => s.key))
    // tokens.max ↔ photoPolicy.people.max
    if (r.inputs && r.inputs.tokens) {
      const photo = pState.config.steps.find((s) => s.type === 'photo')
      const pm = photo && photo.photoPolicy && photo.photoPolicy.people && photo.photoPolicy.people.max
      if (typeof pm === 'number' && r.inputs.tokens.max !== pm)
        errs.push(`tokens.max (${r.inputs.tokens.max}) doit égaler photoPolicy.people.max (${pm}).`)
      // tokens.from doit pointer vers une étape existante (défense — syncRecipeTokens auto-répare)
      if (r.inputs.tokens.from && !inputKeys.has(r.inputs.tokens.from))
        errs.push(`Le mapping des prénoms (${r.inputs.tokens.from}) ne correspond à aucune étape.`)
    }
  }
  // référence obligatoire
  if (!pState.recipeSameAsDesign && !pState.styleRef) errs.push('Image de référence obligatoire (ou coche « le design est la référence »).')
  return errs
}
// Même règle UX que la config : valide = RIEN d'affiché ; seules les erreurs apparaissent.
function renderRecipeValidation() {
  const box = $('#recipeValidation')
  const badge = $('#recipeBadge')
  if (!pState.recipe) { box.className = 'studio-validation hidden'; badge.textContent = ''; return }
  const errs = validateRecipeClient()
  if (!errs.length) {
    box.className = 'studio-validation hidden'
    box.innerHTML = ''
    badge.textContent = ''
  } else {
    box.className = 'studio-validation err'
    box.innerHTML = `✗ ${errs.length} problème(s) :<ul>${errs.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
    badge.textContent = `${errs.length} problème(s)`
  }
  renderAnalysisState() // l'analyse en cours (ou son échec) reprend le badge
}
// Vérification serveur (validate-personalized) : config + recette + unicité slug.
async function runServerVerify() {
  if (!pState.config || !pState.recipe) return
  const btn = $('#recipeVerify')
  const box = $('#recipeVerifyResult')
  btn.disabled = true
  box.classList.remove('hidden')
  box.className = 'studio-validation'
  box.textContent = 'Vérification serveur…'
  try {
    const r = await fetch(API + '/api/shopify-product-publisher/validate-personalized', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        // même forme qu'à la publication : sans productType (généré par le back)
        studioConfig: (() => { const c = { ...pState.config }; delete c.productType; return c })(),
        studioRecipe: pState.recipe,
      }),
    })
    const data = await safeJson(r)
    if (!r.ok || !data.success) throw new Error(r.status === 401 ? 'session expirée — reconnecte-toi' : data.message || 'échec (' + r.status + ')')
    if (data.ok) {
      box.className = 'studio-validation ok'
      box.innerHTML = '✓ Validation serveur OK — prêt à publier.'
    } else {
      box.className = 'studio-validation err'
      box.innerHTML = `✗ ${data.errors.length} erreur(s) serveur :<ul>${data.errors.slice(0, 12).map((e) => `<li>${escapeHtml(e.where + ' — ' + e.message)}</li>`).join('')}</ul>`
    }
  } catch (e) {
    box.className = 'studio-validation err'
    box.textContent = 'Vérification : ' + e.message
  } finally {
    btn.disabled = false
  }
}

/* ---------- Tester le prompt : un rendu d'essai AVANT publication ----------
   Il fallait publier un produit puis commander dans le studio pour savoir ce qu'un design allait
   rendre — chaque réglage de prompt coûtait donc une publication. Le back emprunte le MÊME chemin
   que la production (textes lus sur le design, fragments imposés, même juge) : ce qu'on voit ici
   est ce que la cliente obtiendra. */
const pTest = { inflight: false, photo: null, lastRender: null }

// Champs texte du parcours : ce sont eux qui alimentent le titre et les légendes du dessin.
const testValueSteps = () =>
  ((pState.config && pState.config.steps) || []).filter((s) => ['text', 'number', 'date'].includes(s.type))

function renderRecipeTest() {
  const wrap = $('#recipeTest')
  if (!wrap) return
  if (!pState.config || !pState.recipe) { wrap.innerHTML = ''; return }
  const fields = testValueSteps()
  wrap.innerHTML = `
    <div class="studio-sub">
      <p class="studio-sub-title">Tester le prompt</p>
      <p class="sf-help">Une photo, un rendu — sans rien publier. Même prompt et même juge qu'une vraie commande.</p>
      ${fields.map((s) => fieldBlock(
        t(s.label, 'fr') || t(s.title, 'fr') || s.name, '',
        `<input type="text" class="decor-vibe" data-test-value="${escapeHtml(s.payloadKey || s.name)}"
           maxlength="200" placeholder="${escapeHtml(t(s.placeholder, 'fr') || 'Ce que la cliente écrirait')}">`
      )).join('')}
      ${fieldBlock('Photo de la cliente', '', `<input type="file" accept="image/*" id="rt-photo" class="decor-vibe">`)}
      <div class="photo-ex-slot"><img id="rt-photo-img" src="" alt="" style="min-height:60px"></div>
      <div class="resize-actions">
        <button type="button" class="ghost-btn" id="rt-run">🧪 Tester le prompt</button>
      </div>
      <div id="rt-result"></div>
    </div>`
  wireRecipeTestEvents()
}

function wireRecipeTestEvents() {
  const file = $('#rt-photo')
  if (file) file.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]
    if (!f || !f.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => { pTest.photo = reader.result; $('#rt-photo-img').src = reader.result }
    reader.readAsDataURL(f)
  })
  const run = $('#rt-run')
  if (run) run.addEventListener('click', runRecipeTest)
}

async function runRecipeTest() {
  if (pTest.inflight) return
  if (!state.imageDataUrl) return toast("Ajoute d'abord ton design (carte 1).", 'err')
  if (!pTest.photo) return toast('Choisis une photo de cliente pour le test.', 'err')

  const values = {}
  $$('#recipeTest [data-test-value]').forEach((el) => { values[el.dataset.testValue] = el.value.trim() })

  const btn = $('#rt-run')
  const box = $('#rt-result')
  pTest.inflight = true
  btn.disabled = true
  btn.textContent = '⏳ Génération et jugement… (~1 min)'
  box.innerHTML = ''
  try {
    const { res, data } = await fetchJsonT(
      API + '/api/test-recipe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          artwork: state.imageDataUrl,
          photo: pTest.photo,
          studioConfig: pState.config,
          studioRecipe: pState.recipe,
          values,
        }),
      },
      90000
    )
    if (res.status === 401) throw new Error('Session expirée — reconnecte-toi.')
    const jobId = data.data && data.data.jobId
    if (!res.ok || !data.success || !jobId) throw new Error(data.message || 'Démarrage impossible.')

    const started = Date.now()
    let result = null
    while (!result) {
      if (Date.now() - started > 8 * 60 * 1000) throw new Error('Le test a expiré.')
      await sleep(3000)
      const { res: r2, data: d2 } = await fetchJsonT(
        API + '/api/test-recipe/result?id=' + encodeURIComponent(jobId),
        { headers: { Accept: 'application/json' } },
        20000
      )
      if (r2.status === 404 || d2.status === 'not_found') throw new Error('Session de test expirée.')
      if (d2.status === 'error') throw new Error(d2.message || 'Échec du test.')
      if (d2.status === 'done' && d2.data) result = d2.data
    }
    renderTestResult(result)
  } catch (e) {
    box.innerHTML = `<div class="studio-validation err">${escapeHtml(e.message)}</div>`
  } finally {
    pTest.inflight = false
    const b = $('#rt-run')
    if (b) { b.disabled = false; b.textContent = '🧪 Tester le prompt' }
  }
}

// Le verdict du juge est affiché AVEC son motif : c'est lui qui recale les candidats en production,
// donc c'est lui qu'il faut pouvoir lire ici pour corriger le prompt sans publier.
function renderTestResult(r) {
  const box = $('#rt-result')
  const verdict = r.pass
    ? `<div class="studio-validation ok">✓ Le juge accepterait ce rendu${r.score != null ? ` — note ${r.score}/10` : ''}</div>`
    : `<div class="studio-validation err">✗ Le juge le refuserait${r.score != null ? ` — note ${r.score}/10` : ''}${r.reason ? `<br>${escapeHtml(r.reason)}` : ''}</div>`
  const warns = (r.warnings || []).length
    ? `<ul class="sf-help">${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
    : ''
  pTest.lastRender = r.image
  const modelLabel = providerLabel(r.provider)
  box.innerHTML = `
    <div class="photo-ex-slot"><img src="${r.image}" alt="Rendu d'essai"></div>
    <p class="sf-help">Rendu par ${escapeHtml(modelLabel)}</p>
    ${verdict}${warns}
    <div class="resize-actions">
      <button type="button" class="primary-btn" id="rt-proof">＋ Ajouter la preuve aux visuels</button>
    </div>
    <button type="button" class="i18n-toggle" id="rt-prompt-toggle">▾ Voir le prompt envoyé</button>
    <div id="rt-prompt" class="hidden"><textarea readonly style="min-height:220px">${escapeHtml(r.prompt)}</textarea></div>`
  const proof = $('#rt-proof')
  if (proof) proof.addEventListener('click', addProofToResults)
  const tog = $('#rt-prompt-toggle')
  if (tog) tog.addEventListener('click', () => {
    const hidden = $('#rt-prompt').classList.toggle('hidden')
    tog.textContent = hidden ? '▾ Voir le prompt envoyé' : '▴ Masquer le prompt'
  })
}

/* ---------- Preuve « avant → après » ----------
   Un seul visuel qui montre le passage de la photo au tableau : c'est l'argument le plus direct
   pour un produit personnalisé, et il ne peut pas être générique — il doit montrer CE design.
   Tout est CALCULÉ (aucune image de gabarit, aucun cadre en dur) pour s'adapter à n'importe quel
   couple photo/rendu : portrait, paysage, carré, famille, animal. */
const PROOF = {
  size: 2000,
  bg: '#FBF7F2',        // crème de la marque (fond des fiches)
  mat: '#FFFFFF',       // marie-louise de la photo
  frame: '#E3D9CE',     // filet chaud autour du rendu
  ink: '#8A7862',       // flèche — assez sombre pour se lire en vignette de galerie
}

// Contient `img` dans la boîte (jamais déformé, jamais rogné) et rend sa boîte réelle.
function proofFit(img, box) {
  const scale = Math.min(box.w / img.width, box.h / img.height)
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h }
}

function proofRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

const proofLoad = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = src
  })

/**
 * Compose la preuve : photo à gauche, flèche, rendu à droite. Rend un data URL JPEG.
 *
 * Les deux visuels reçoivent la MÊME case : à format égal ils sortent de la même taille, et la
 * lecture devient « la même chose, transformée » plutôt qu'une vignette à côté d'une affiche.
 * Aucun texte : le visuel part chez des clientes fr/en/de/nl/es, une légende française serait fausse
 * pour quatre d'entre elles — la flèche se lit dans toutes les langues.
 */
async function buildProofImage(photoUrl, renderUrl) {
  const [photo, render] = await Promise.all([proofLoad(photoUrl), proofLoad(renderUrl)])
  const S = PROOF.size
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  ctx.fillStyle = PROOF.bg
  ctx.fillRect(0, 0, S, S)

  const pad = Math.round(S * 0.055)
  const gutter = Math.round(S * 0.10) // couloir de la flèche
  const cellW = Math.round((S - pad * 2 - gutter) / 2)
  const cellH = S - pad * 2
  const mat = Math.round(S * 0.010)
  const bd = Math.round(S * 0.008)

  const pf = proofFit(photo, { x: pad + mat, y: pad + mat, w: cellW - mat * 2, h: cellH - mat * 2 })
  const rf = proofFit(render, { x: S - pad - cellW + bd, y: pad + bd, w: cellW - bd * 2, h: cellH - bd * 2 })

  // --- photo : marie-louise blanche + ombre douce (elle se lit comme un tirage, pas comme l'œuvre)
  ctx.save()
  ctx.shadowColor = 'rgba(60,45,30,0.16)'
  ctx.shadowBlur = Math.round(S * 0.02)
  ctx.shadowOffsetY = Math.round(S * 0.006)
  ctx.fillStyle = PROOF.mat
  proofRoundRect(ctx, pf.x - mat, pf.y - mat, pf.w + mat * 2, pf.h + mat * 2, Math.round(S * 0.016))
  ctx.fill()
  ctx.restore()
  ctx.save()
  proofRoundRect(ctx, pf.x, pf.y, pf.w, pf.h, Math.round(S * 0.010))
  ctx.clip()
  ctx.drawImage(photo, pf.x, pf.y, pf.w, pf.h)
  ctx.restore()

  // --- rendu : filet chaud + ombre portée (le « tableau »)
  ctx.save()
  ctx.shadowColor = 'rgba(60,45,30,0.20)'
  ctx.shadowBlur = Math.round(S * 0.028)
  ctx.shadowOffsetY = Math.round(S * 0.010)
  ctx.fillStyle = PROOF.frame
  ctx.fillRect(rf.x - bd, rf.y - bd, rf.w + bd * 2, rf.h + bd * 2)
  ctx.restore()
  ctx.drawImage(render, rf.x, rf.y, rf.w, rf.h)

  // --- flèche, sur l'axe commun des deux visuels et à l'échelle de l'image (sinon elle disparaît)
  const midY = Math.round((pf.y + pf.h / 2 + rf.y + rf.h / 2) / 2)
  const aw = Math.round(S * 0.068)
  const ah = Math.round(S * 0.050)
  const ax = Math.round(pad + cellW + (gutter - aw) / 2)
  ctx.fillStyle = PROOF.ink
  ctx.beginPath()
  ctx.moveTo(ax, midY - ah * 0.20)
  ctx.lineTo(ax + aw * 0.58, midY - ah * 0.20)
  ctx.lineTo(ax + aw * 0.58, midY - ah * 0.5)
  ctx.lineTo(ax + aw, midY)
  ctx.lineTo(ax + aw * 0.58, midY + ah * 0.5)
  ctx.lineTo(ax + aw * 0.58, midY + ah * 0.20)
  ctx.lineTo(ax, midY + ah * 0.20)
  ctx.closePath()
  ctx.fill()

  return c.toDataURL('image/jpeg', 0.92)
}

/** Ajoute la preuve aux visuels publiés (même file que les mockups). */
async function addProofToResults() {
  const btn = $('#rt-proof')
  if (!btn || !pTest.photo || !pTest.lastRender) return
  btn.disabled = true
  btn.textContent = 'Composition…'
  try {
    const url = await buildProofImage(pTest.photo, pTest.lastRender)
    // Un nouveau test rend le bouton à nouveau actif : la preuve du test précédent est REMPLACÉE,
    // jamais empilée (sinon on publie autant de preuves que d'essais).
    const stale = state.results.filter((r) => r.proof)
    if (stale.length) state.results = state.results.filter((r) => !r.proof)
    state.results.push({
      id: 'proof' + Date.now() + Math.random().toString(36).slice(2, 5),
      path: null,
      url,
      context: 'Avant / après — de la photo au tableau',
      label: 'Avant / après',
      proof: true, // statut à part : ni jumeau passe-partout, ni bascule « avec / sans cadre »
    })
    renderResults()
    refreshAction()
    toast('Preuve ajoutée ✓ — elle ouvre la galerie et sert d’image de carte', 'ok')
    btn.textContent = 'Preuve ajoutée ✓'
  } catch (e) {
    toast('Composition impossible : ' + e.message, 'err')
    btn.disabled = false
    btn.textContent = '＋ Ajouter la preuve aux visuels'
  }
}

/* ---------- Éditeur d'étape (overlay) ---------- */
function openStepEditor(index) {
  const step = pState.config.steps[index]
  // une proposition IA non validée d'une session précédente ne survit pas (par slot)
  pendingExample.good = pendingExample.bad = null
  exGenToken.good = {}
  exGenToken.bad = {}
  pState.editing = { index, working: JSON.parse(JSON.stringify(step)) }
  $('#studioStepTitle').textContent = `Modifier « ${t(step.title, 'fr') || step.name} »`
  renderStepEditorBody()
  $('#studioStepOverlay').classList.remove('hidden')
}
function closeStepEditor() {
  $('#studioStepOverlay').classList.add('hidden')
  pState.editing = null
}
// Construit un bloc « champ simple » (input/select/textarea) piloté par un getter/setter.
// Modèles d'image proposés. Le back accepte n'importe quel « <fournisseur>:<modèle> » ; ici la
// liste est FERMÉE — un identifiant libre ne se verrait refusé qu'à la publication.
// « Par défaut » n'écrit RIEN dans la recette : le produit retombe sur son modèle historique,
// c'est ce qui garantit qu'aucun tableau déjà publié ne change de comportement.
const RECIPE_MODELS = [
  { id: '', label: 'Par défaut (Gemini)' },
  { id: 'openai:gpt-image-2', label: 'ChatGPT (GPT Image)' },
]
// Modèle actuellement choisi = 1re entrée de la chaîne, ou « par défaut » si aucune chaîne.
function recipeModelChoice(r) {
  const first = r && r.providers && r.providers.chain && r.providers.chain[0]
  return RECIPE_MODELS.some((m) => m.id && m.id === first) ? first : ''
}
// Écrit le choix : le modèle choisi et LUI SEUL.
// Un secours serait un piège ici. Une commande lance plusieurs rendus EN PARALLÈLE, chacun
// bascule sur le maillon suivant à la moindre erreur (un 429 suffit), et c'est le rendu le mieux
// noté qui est élu — pas celui du modèle demandé. Un incident réseau livrerait donc à la cliente
// le style qu'on avait justement choisi d'éviter, sans que rien ne le signale. En cas d'échec
// total, la commande part en revue manuelle : c'est le comportement historique, et il est honnête.
function setRecipeModelChoice(r, id) {
  if (!id) { delete r.providers; return }
  r.providers = { chain: [id] }
}
// Libellé lisible d'un modèle : les clés Gemini ne sont pas dans la liste (elles viennent du
// réglage historique du produit), il ne faut pas afficher l'identifiant technique pour autant.
function providerLabel(key) {
  const known = RECIPE_MODELS.find((m) => m.id && m.id === key)
  if (known) return known.label
  if (String(key || '').startsWith('gemini:')) return 'Gemini (modèle habituel)'
  return key || 'modèle inconnu'
}
function fieldBlock(label, help, controlHtml) {
  return `<div class="studio-field"><label>${escapeHtml(label)}</label>${controlHtml}${help ? `<p class="sf-help">${escapeHtml(help)}</p>` : ''}</div>`
}
function renderStepEditorBody() {
  const s = pState.editing.working
  const body = $('#studioStepBody')
  const parts = []
  // TOUT est préfabriqué par le catalogue (textes compris, traduits à la publication) : plus
  // aucun champ de texte éditable. Seule la PHOTO a de vrais réglages — contrôle automatique,
  // règles, exemples. (L'éditeur ne s'ouvre d'ailleurs que pour elle.)
  if (s.type === 'photo') {
    parts.push(`<label class="studio-check"><input type="checkbox" id="sf-photoCheck" ${s.photoCheck ? 'checked' : ''}> Contrôler automatiquement la photo du client</label>`)
    parts.push(renderPhotoPolicyEditor(s))
    parts.push(renderPhotoExamplesEditor(s))
  }

  body.innerHTML = parts.join('')
  wireStepEditorEvents()
}
function renderPhotoPolicyEditor(s) {
  // Contrôle décoché = aucune règle à régler. Coché sans politique (étape venue du catalogue,
  // qui n'en porte pas) : on en pose une neutre, sinon la grille d'angles ne s'afficherait
  // jamais et la case resterait sans effet.
  if (!s.photoCheck) return ''
  const pol = s.photoPolicy || (s.photoPolicy = blankPhotoPolicy())
  const angleRows = PHOTO_ANGLES.map((a) => {
    const cur = (pol.angles && pol.angles[a.key]) || 'warn'
    const opts = PHOTO_GRADES.map((g) =>
      `<button type="button" class="angle-opt ${cur === g.key ? 'on' : ''}" data-angle="${a.key}" data-grade="${g.key}" title="${g.fr}">${g.icon}</button>`
    ).join('')
    return `<div class="angle-row"><span class="angle-name">${a.fr}</span><span class="angle-opts">${opts}</span></div>`
  }).join('')
  const isGroup = pol.subject === 'group'
  return `<div class="studio-sub" id="sf-policy">
    <p class="studio-sub-title">Règles de la photo</p>
    <div class="studio-row">
      ${fieldBlock('Sujet', '', `<select id="sf-pol-subject"><option value="person"${!isGroup ? ' selected' : ''}>Une personne</option><option value="group"${isGroup ? ' selected' : ''}>Un groupe</option></select>`)}
      ${fieldBlock('Cadrage', '', `<select id="sf-pol-framing"><option value="face"${pol.framing !== 'full-body' ? ' selected' : ''}>Visage</option><option value="full-body"${pol.framing === 'full-body' ? ' selected' : ''}>En pied</option></select>`)}
    </div>
    <div class="studio-row" id="sf-pol-people" ${isGroup ? '' : 'style="display:none"'}>
      ${fieldBlock('Personnes min', '', `<input type="number" id="sf-pol-min" min="1" value="${(pol.people && pol.people.min) ?? 1}">`)}
      ${fieldBlock('Personnes max', '', `<input type="number" id="sf-pol-max" min="1" value="${(pol.people && pol.people.max) ?? 6}">`)}
    </div>
    <p class="sf-help">Pour chaque angle de prise de vue : 🟢 parfait · 🟡 accepté · 🔴 refusé.</p>
    <div class="angle-grid">${angleRows}</div>
  </div>`
}
function renderPhotoExamplesEditor(s) {
  // IMAGE PAR IMAGE : chaque slot se génère, se valide et se remplace INDÉPENDAMMENT
  // (une bonne image gardée n'est jamais regénérée parce que l'autre a raté). La consigne
  // optionnelle est réécrite en vrai prompt par le backend (comme « salon marocain » -> décor).
  // Le feedback de génération vit SUR le bouton cliqué (libellé + désactivation) : l'overlay
  // scrolle et un spinner placé ailleurs sort du champ de vision -> « il ne se passe rien ».
  const slot = (kind, src, label, ph, extra = '') =>
    `<div class="photo-ex-slot">
      <label>${label}</label>${extra}
      <img id="sf-ex-${kind}-img" src="${src || ''}" alt="" ${src ? '' : 'style="min-height:90px"'}>
      <input type="text" id="sf-ex-${kind}-wish" class="decor-vibe" maxlength="300" placeholder="${ph}">
      <div class="resize-actions" id="sf-ex-${kind}-idle">
        <button type="button" class="ghost-btn" id="sf-ex-${kind}-gen">✨ Générer par IA</button>
      </div>
      <div class="resize-actions hidden" id="sf-ex-${kind}-pending">
        <button type="button" class="primary-btn" id="sf-ex-${kind}-accept">Garder ✓</button>
        <button type="button" class="ghost-btn" id="sf-ex-${kind}-regen">↻ Une autre</button>
        <button type="button" class="ghost-btn" id="sf-ex-${kind}-reject">✕</button>
      </div>
      <input type="file" accept="image/*" id="sf-ex-${kind}" class="decor-vibe">
    </div>`
  // Les DEUX légendes affichées au client, à leur place — sous l'image qu'elles décrivent.
  // Celle de la bonne photo appartient au thème et suit l'angle 🟢 : montrée, non modifiable
  // (la changer, c'est changer l'angle juste au-dessus). Celle de la mauvaise vient de nous :
  // écrite par l'analyse du design, et rectifiable ici.
  const goodCaption = `<p class="sf-help">Texte vu par le client : « ${escapeHtml(
    THEME_GOOD_CAPTION_FR[s.faceAngle] || THEME_GOOD_CAPTION_FR.front
  )} » — il suit l'angle 🟢 ci-dessus.</p>`
  const badCaption = `<input type="text" id="sf-ex-bad-caption" class="decor-vibe" maxlength="160"
      placeholder="Texte vu par le client" value="${escapeHtml(t(getI18nMap(s, 'examples.bad.caption'), 'fr'))}">`
  return `<div class="studio-sub"><p class="studio-sub-title">Exemples photo</p>
    <div class="photo-ex">
      ${slot('good', pState.photoExamples.good, 'Bonne photo', 'Consigne (optionnel) — ex. deux personnes vues de dos', goodCaption)}
      ${slot('bad', pState.photoExamples.bad, 'Photo à éviter', 'Consigne (optionnel) — ex. jambes coupées, photo sombre', badCaption)}
    </div>
  </div>`
}
// Propositions IA en attente, PAR image — validées/refusées indépendamment avant pState.
const pendingExample = { good: null, bad: null }
// Jetons anti-péremption par slot (re-render de l'éditeur / relance pendant une génération).
const exGenToken = { good: null, bad: null }
// Job asynchrone (même patron anti-524 que le décor : start -> polling).
async function callPhotoExamplesJob(body) {
  let startRes, startData
  try {
    ;({ res: startRes, data: startData } = await fetchJsonT(
      API + '/api/generate-photo-examples',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
      90000
    ))
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Le service met trop de temps à démarrer. Réessaye.' : 'Connexion au serveur impossible.')
  }
  if (startRes.status === 401) throw new Error('Session expirée — reconnecte-toi.')
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Impossible de démarrer (' + startRes.status + ')')
  }
  const startedAt = Date.now()
  const MAX_MS = 11 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error('La génération a expiré. Réessaye.')
    await sleep(3000)
    let res, data
    try {
      ;({ res, data } = await fetchJsonT(
        API + '/api/generate-photo-examples/result?id=' + encodeURIComponent(jobId),
        { headers: { Accept: 'application/json' } },
        20000
      ))
    } catch (e) {
      if (++netErrors > 6) throw new Error('Connexion interrompue pendant la génération.')
      continue
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found') throw new Error('Session de génération expirée. Relance.')
    if (data.status === 'error') throw new Error(data.message || 'Échec de la génération.')
    if (data.status === 'done' && data.data && data.data.image) return data.data.image
  }
}
// Règles envoyées au générateur : dérivées de la photoPolicy de l'étape (déterministe).
function photoExamplesPolicyOf(step) {
  const pol = step.photoPolicy || {}
  const angles = pol.angles || {}
  const perfect = Object.entries(angles).find(([, g]) => g === 'perfect')
  const rejects = Object.entries(angles).filter(([, g]) => g === 'reject').map(([a]) => a)
  return {
    subject: pol.subject,
    framing: pol.framing,
    peopleMin: pol.people && pol.people.min,
    peopleMax: pol.people && pol.people.max,
    perfectAngle: (perfect && perfect[0]) || step.faceAngle || 'front',
    rejectAngles: rejects,
    companions: pState.planAnimals,
  }
}
// Génère UNE image (bonne OU à éviter) ; la consigne du slot (OPTIONNELLE — vide = tout
// automatique depuis le design) est réécrite côté back. Feedback SUR le bouton cliqué.
async function generateOneExample(step, kind) {
  if (!state.imageDataUrl) return toast("Ajoute d'abord ton design (carte 1) — les exemples en dérivent.", 'err')
  if (state.needsResize) return toast("Retaille d'abord l'image au bon format.", 'err')
  const el = (suffix) => $(`#sf-ex-${kind}-${suffix}`)
  const token = (exGenToken[kind] = {})
  // pendant la génération : le bouton Générer reste À SA PLACE, désactivé, libellé parlant
  el('pending').classList.add('hidden')
  el('idle').classList.remove('hidden')
  const gen = el('gen')
  gen.disabled = true
  gen.textContent = '⏳ Génération en cours… (~15 s)'
  const restoreGen = () => {
    const g = el('gen')
    if (g) { g.disabled = false; g.textContent = '✨ Générer par IA' }
  }
  try {
    const wishEl = el('wish')
    const image = await callPhotoExamplesJob({
      artwork: state.imageDataUrl,
      kind,
      intent: (wishEl && wishEl.value.trim()) || undefined,
      policy: photoExamplesPolicyOf(step),
    })
    // périmé (éditeur re-rendu / relance / upload) ou DOM disparu -> on jette sans toucher l'UI
    if (token !== exGenToken[kind] || !el('img')) return
    restoreGen()
    pendingExample[kind] = image
    el('img').src = image
    el('idle').classList.add('hidden')
    el('pending').classList.remove('hidden')
  } catch (e) {
    toast('Exemple : ' + e.message, 'err')
    if (token !== exGenToken[kind] || !el('img')) return
    restoreGen()
    // retour à l'état d'avant la tentative (proposition précédente ou image gardée)
    if (pendingExample[kind]) {
      el('idle').classList.add('hidden')
      el('pending').classList.remove('hidden')
    }
  }
}
// Câble les events du corps de l'éditeur (une fois rendu).
function wireStepEditorEvents() {
  const s = pState.editing.working
  // photoCheck : bascule photoPolicy (re-render)
  const pcCb = $('#sf-photoCheck')
  if (pcCb) pcCb.addEventListener('change', () => {
    collectSimpleFields()
    s.photoCheck = pcCb.checked
    renderStepEditorBody()
  })
  // policy subject -> montre/cache people
  const subj = $('#sf-pol-subject')
  if (subj) subj.addEventListener('change', () => {
    $('#sf-pol-people').style.display = subj.value === 'group' ? '' : 'none'
  })
  // grille d'angles
  $$('#studioStepBody .angle-opt').forEach((btn) =>
    btn.addEventListener('click', () => {
      const angle = btn.dataset.angle
      $$(`#studioStepBody .angle-opt[data-angle="${angle}"]`).forEach((b) => b.classList.remove('on'))
      btn.classList.add('on')
    })
  )
  // exemples photo — IMAGE PAR IMAGE : générer / garder / une autre / annuler / uploader,
  // chaque slot vit sa vie (une image validée n'est jamais perdue par l'échec de l'autre).
  for (const kind of ['good', 'bad']) {
    const el = (suffix) => $(`#sf-ex-${kind}-${suffix}`)
    const inp = $(`#sf-ex-${kind}`)
    if (!inp) continue
    // upload manuel : adopte directement l'image et annule toute proposition IA du slot
    inp.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0]
      if (!f || !f.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        exGenToken[kind] = {} // périme une génération en vol sur ce slot
        pendingExample[kind] = null
        el('pending').classList.add('hidden')
        el('idle').classList.remove('hidden')
        const g = el('gen')
        if (g) { g.disabled = false; g.textContent = '✨ Générer par IA' }
        pState.photoExamples[kind] = reader.result
        el('img').src = reader.result
      }
      reader.readAsDataURL(f)
    })
    el('gen').addEventListener('click', () => generateOneExample(s, kind))
    el('accept').addEventListener('click', () => {
      if (!pendingExample[kind]) return
      pState.photoExamples[kind] = pendingExample[kind]
      pendingExample[kind] = null
      el('pending').classList.add('hidden')
      el('idle').classList.remove('hidden')
      toast('Image gardée ✓', 'ok')
    })
    el('regen').addEventListener('click', () => generateOneExample(s, kind))
    el('reject').addEventListener('click', () => {
      pendingExample[kind] = null
      el('pending').classList.add('hidden')
      el('idle').classList.remove('hidden')
      el('img').src = pState.photoExamples[kind] || ''
    })
  }
}
// Lit les champs simples (hors i18n) du DOM vers l'objet working. Tout le technique
// (name/payloadKey/required/bornes/mode/consent/cartProperty) est IMPOSÉ par le catalogue :
// seule la photo a de vrais réglages (contrôle + règles).
function collectSimpleFields() {
  const s = pState.editing.working
  const val = (id) => { const el = $(id); return el ? el.value : undefined }
  const num = (id) => { const v = val(id); return v === '' || v == null ? undefined : parseInt(v, 10) }
  if (s.type === 'photo') {
    if ($('#sf-photoCheck')) s.photoCheck = $('#sf-photoCheck').checked
    if (s.photoPolicy && $('#sf-pol-subject')) {
      const pol = s.photoPolicy
      pol.subject = val('#sf-pol-subject')
      pol.framing = val('#sf-pol-framing')
      if (pol.subject === 'group') pol.people = { min: num('#sf-pol-min') || 1, max: num('#sf-pol-max') || 6 }
      else delete pol.people
      // angles depuis la grille
      const angles = {}
      $$('#studioStepBody .angle-opt.on').forEach((b) => { angles[b.dataset.angle] = b.dataset.grade })
      pol.angles = angles
      // consigne photo déduite = angle marqué 🟢 (repli : face)
      const perfect = Object.entries(angles).find(([, g]) => g === 'perfect')
      s.faceAngle = perfect ? perfect[0] : 'front'
    }
    // Légende de la mauvaise photo (seule des deux qui nous appartienne). Vidée = on retire la
    // clé : le thème retombe alors sur son texte générique plutôt que d'afficher du blanc.
    const cap = $('#sf-ex-bad-caption')
    if (cap) {
      const v = cap.value.trim()
      s.examples = s.examples || {}
      s.examples.bad = s.examples.bad || {}
      if (v) s.examples.bad.caption = { fr: v }
      else delete s.examples.bad.caption
    }
  }
}
function saveStepEditor() {
  collectSimpleFields()
  pState.config.steps[pState.editing.index] = pState.editing.working
  closeStepEditor()
  onConfigChanged()
  toast('Étape enregistrée ✓', 'ok')
}

/* ---------- Ajout / duplication / suppression d'étapes ---------- */
// Sélecteur d'étapes CONCRÈTES (catalogue) : tout est prérempli et déjà traduit — l'ajout ne
// demande aucune saisie. Jamais de type générique.
function openTypePicker() {
  const list = $('#studioTypeList')
  const photoFull = $('#studioAddStep').dataset.photoFull === '1'
  // Épuré : le NOM seul (règle UX). La seule mention ajoutée est la raison d'un choix grisé.
  list.innerHTML = STEP_CATALOG.map((entry, i) => {
    const dis = entry.step.type === 'photo' && photoFull
    return `<button class="section-opt" data-catalog="${i}" ${dis ? 'disabled' : ''}>
      <span>${entry.icon} ${escapeHtml(entry.label)}${dis ? ' — déjà présente' : ''}</span></button>`
  }).join('')
  list.querySelectorAll('.section-opt').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.disabled) return
      addCatalogStep(STEP_CATALOG[parseInt(b.dataset.catalog, 10)])
      $('#studioTypeOverlay').classList.add('hidden')
    })
  )
  $('#studioTypeOverlay').classList.remove('hidden')
}
function uniqueStepName(base) {
  let name = base, i = 2
  const taken = new Set(pState.config.steps.map((s) => s.name))
  while (taken.has(name)) name = base + i++
  return name
}
function addCatalogStep(entry) {
  const steps = pState.config.steps
  const step = JSON.parse(JSON.stringify(entry.step))
  // nom déjà pris (ex. 2 dates) -> suffixe, payloadKey aligné
  if (steps.some((s) => s.name === step.name)) {
    step.name = uniqueStepName(step.name)
    step.payloadKey = step.name
  }
  // insertion AVANT l'étape format (qui reste toujours en dernier)
  const fmtIdx = steps.findIndex((s) => s.type === 'format')
  if (fmtIdx >= 0) steps.splice(fmtIdx, 0, step); else steps.push(step)
  onConfigChanged()
  toast(`« ${entry.label} » ajoutée ✓ — déjà traduite, rien à remplir`, 'ok')
}
function deleteStep(index) {
  const s = pState.config.steps[index]
  if (s.type === 'format') return
  if (!confirm(`Supprimer l’étape « ${s.name} » ?`)) return
  pState.config.steps.splice(index, 1)
  onConfigChanged()
}
// Garantit que l'étape format reste la dernière (contrat moteur : prix/variantes).
function pinFormatLast() {
  const steps = pState.config.steps
  const i = steps.findIndex((s) => s.type === 'format')
  if (i >= 0 && i !== steps.length - 1) steps.push(steps.splice(i, 1)[0])
}

/* ---------- Réordonnancement par appui long + glisser (liste verticale) ---------- */
let pdrag = null
const P_ARM_MS = 350, P_SLOP = 10
function attachStepDrag(cell) {
  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return
    if (e.target.closest('button')) return
    if (pdrag) return
    pdrag = { cell, name: cell.dataset.name, grid: cell.parentElement, pointerId: e.pointerId,
      pointerType: e.pointerType, startY: e.clientY, armed: false, timer: null, ph: null, grabY: 0 }
    if (e.pointerType !== 'mouse') pdrag.timer = setTimeout(() => { if (pdrag) armStepDrag() }, P_ARM_MS)
    document.addEventListener('pointermove', onStepDragMove, { passive: false })
    document.addEventListener('pointerup', endStepDrag)
    document.addEventListener('pointercancel', cancelStepDrag)
  })
  cell.addEventListener('dragstart', (e) => e.preventDefault())
}
function armStepDrag() {
  const c = pdrag.cell
  if (!c.isConnected) { teardownStepDrag(); return }
  const r = c.getBoundingClientRect()
  pdrag.armed = true
  pdrag.grabY = pdrag.startY - r.top
  pdrag.w = r.width; pdrag.h = r.height
  pdrag.grid.style.minHeight = pdrag.grid.offsetHeight + 'px'
  pdrag.grid.classList.add('reordering')
  try { c.setPointerCapture(pdrag.pointerId); pdrag.captured = true } catch (_) {}
  const ph = document.createElement('div')
  ph.className = 'studio-step placeholder'
  ph.style.height = pdrag.h + 'px'
  pdrag.grid.insertBefore(ph, c)
  pdrag.ph = ph
  c.style.width = pdrag.w + 'px'
  c.classList.add('dragging')
  moveStepProxy(pdrag.startY)
  if (navigator.vibrate) navigator.vibrate(12)
}
function onStepDragMove(e) {
  if (!pdrag || e.pointerId !== pdrag.pointerId) return
  if (!pdrag.armed) {
    if (Math.abs(e.clientY - pdrag.startY) <= P_SLOP) return
    if (pdrag.pointerType === 'mouse') { armStepDrag(); if (!pdrag) return }
    else { cancelStepDrag(); return }
  }
  e.preventDefault()
  moveStepProxy(e.clientY)
  const cells = [...pdrag.grid.children].filter((n) => n !== pdrag.cell && n !== pdrag.ph)
  let ref = null
  for (const n of cells) {
    const r = n.getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) { ref = n; break }
  }
  if (pdrag.ph.nextSibling !== ref) pdrag.grid.insertBefore(pdrag.ph, ref)
}
function moveStepProxy(y) {
  const gr = pdrag.grid.getBoundingClientRect()
  pdrag.cell.style.transform = `translate(${gr.left}px,${y - pdrag.grabY}px)`
}
function endStepDrag() {
  if (!pdrag) return
  if (!pdrag.armed) { teardownStepDrag(); return }
  const order = [...pdrag.grid.children]
    .map((n) => (n === pdrag.ph ? pdrag.name : n === pdrag.cell ? null : n.dataset.name))
    .filter(Boolean)
  pdrag.grid.classList.remove('reordering')
  pdrag.grid.style.minHeight = ''
  teardownStepDrag()
  const steps = pState.config.steps
  steps.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  pinFormatLast()
  onConfigChanged()
}
function cancelStepDrag() { if (pdrag) { pdrag.grid.classList.remove('reordering'); pdrag.grid.style.minHeight = ''; teardownStepDrag(); renderStudioSteps() } }
function teardownStepDrag() {
  if (!pdrag) return
  const cur = pdrag
  pdrag = null
  if (cur.timer) clearTimeout(cur.timer)
  if (cur.ph) cur.ph.remove()
  cur.cell.classList.remove('dragging')
  cur.cell.style.transform = cur.cell.style.width = ''
  try { if (cur.captured) cur.cell.releasePointerCapture(cur.pointerId) } catch (_) {}
  document.removeEventListener('pointermove', onStepDragMove)
  document.removeEventListener('pointerup', endStepDrag)
  document.removeEventListener('pointercancel', cancelStepDrag)
}

/* ---------- Aperçu du parcours client ----------
   (FR uniquement — les 4 autres langues sont générées par le backend à la publication,
   depuis le même texte : rien d'autre à contrôler ici.) */
function renderStudioPreview() {
  const wrap = $('#studioPreviewWrap')
  if (!pState.config) { wrap.classList.add('hidden'); return }
  wrap.classList.remove('hidden')
  const lang = 'fr'
  // stepper — SANS l'étape format : gérée automatiquement (variantes), rien à contrôler ici
  const steps = pState.config.steps.filter((s) => s.type !== 'format')
  if (!steps.some((s) => s.name === pState.previewStepName)) pState.previewStepName = steps[0] && steps[0].name
  $('#studioPreviewStepper').innerHTML = steps.map((s, i) =>
    `<button class="${s.name === pState.previewStepName ? 'on' : ''}" data-name="${escapeHtml(s.name)}">` +
    `<span class="sp-dot">${i + 1}</span>${escapeHtml(t(s.checkpointLabel, lang) || s.name)}</button>`
  ).join('')
  $$('#studioPreviewStepper button').forEach((b) =>
    b.addEventListener('click', () => { pState.previewStepName = b.dataset.name; renderStudioPreview() })
  )
  // corps de l'étape sélectionnée
  const step = steps.find((s) => s.name === pState.previewStepName) || steps[0]
  const body = $('#studioPreviewBody')
  if (!step) { body.innerHTML = ''; return }
  const parts = [`<h4>${escapeHtml(t(step.title, lang) || '(titre manquant)')}</h4>`]
  if (step.type === 'photo') {
    const good = pState.photoExamples.good, bad = pState.photoExamples.bad
    parts.push(`<div class="sp-field"><div class="sp-fake">📷 Déposez votre photo ici</div></div>`)
    if (good || bad) {
      parts.push('<div class="sp-examples">')
      // Bonne photo : le texte du THÈME, choisi par l'angle (et non le alt, invisible en boutique).
      if (good) parts.push(`<div class="sp-ex"><img src="${good}" alt=""><span>✅ ${escapeHtml(THEME_GOOD_CAPTION_FR[step.faceAngle] || THEME_GOOD_CAPTION_FR.front)}</span></div>`)
      if (bad) parts.push(`<div class="sp-ex bad"><img src="${bad}" alt=""><span>⛔ ${escapeHtml(t(getI18nMap(step, 'examples.bad.caption'), lang))}</span></div>`)
      parts.push('</div>')
    }
  } else {
    const label = t(step.label, lang) || t(step.title, lang)
    const ph = t(step.placeholder, lang)
    parts.push(`<div class="sp-field"><label>${escapeHtml(label)}</label><div class="sp-fake">${escapeHtml(ph || '…')}</div>` +
      (step.help ? `<div class="sp-help">${escapeHtml(t(step.help, lang))}</div>` : '') + `</div>`)
  }
  body.innerHTML = parts.join('')
}

/* ---------- Orchestration ---------- */
function onConfigChanged() {
  renderStudioSteps()
  renderStudioValidation()
  renderStudioPreview()
  // les entrées de la recette dérivent des étapes de config -> rafraîchir le formulaire recette,
  // sauf si l'utilisateur est en train d'y taper (ne pas voler le focus).
  if (pState.recipe && (!document.activeElement || !document.activeElement.closest('#recipeForm')))
    renderRecipeForm()
  refreshAction()
}

/* ---------- Collection parente : pré-suggestion ---------- */
async function suggestDefaultCollection() {
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

/* ---------- Analyse du design : le prompt s'écrit tout seul (relecture seule) ---------- */
// À CHAQUE nouveau design au bon format, le backend regarde l'image et écrit les fragments de
// prompt (style, typographie du titre, séparateurs des légendes…). Walid ne fait que relire.
// doneFor = design déjà analysé (ou acté en échec) ; phase = ce que le serveur fait en ce moment ;
// failed = dernier essai en échec (affiché de façon PERSISTANTE, avec un bouton réessayer : un
// toast qui passe pendant qu'on regarde ailleurs, c'est « il ne s'est rien passé »).
const pAnalysis = { inflight: false, doneFor: null, phase: null, failed: null }
const ANALYSIS_LABEL = { plan: 'lecture de votre design…', prompt: 'écriture du prompt…' }
/* État de l'analyse posé sur les DEUX cartes qu'elle remplit (3 et 4) : c'est là que Walid
   regarde, et elles restaient vides pendant 30 à 60 s. Prioritaire sur les badges de validation
   (renderStudioValidation / renderRecipeValidation s'effacent tant que ceci parle). */
function renderAnalysisState() {
  for (const sel of ['#studioBadge', '#recipeBadge']) {
    const el = $(sel)
    if (!el) continue
    if (pAnalysis.inflight) {
      el.innerHTML = `<span class="badge-spin"></span>${escapeHtml(ANALYSIS_LABEL[pAnalysis.phase] || ANALYSIS_LABEL.plan)}`
    } else if (pAnalysis.failed) {
      el.innerHTML = `<button type="button" class="badge-retry" title="${escapeHtml(pAnalysis.failed)}">↻ Analyse échouée — réessayer</button>`
      const btn = el.querySelector('.badge-retry')
      if (btn) btn.addEventListener('click', retryDesignAnalysis)
    }
  }
}
// L'analyse ne se relance pas toute seule après un échec (pas de boucle de relance sur un
// service payant) : c'est ce bouton qui la redemande.
function retryDesignAnalysis() {
  pAnalysis.failed = null
  pAnalysis.doneFor = null
  refreshAction()
}
async function callAnalyzeDesignJob(body, onPhase) {
  let startRes, startData
  try {
    ;({ res: startRes, data: startData } = await fetchJsonT(
      API + '/api/analyze-design',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
      90000
    ))
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Le service met trop de temps à démarrer.' : 'Connexion au serveur impossible.')
  }
  if (startRes.status === 401) throw new Error('Session expirée — reconnecte-toi.')
  const jobId = startData.data && startData.data.jobId
  if (!startRes.ok || !startData.success || !jobId) {
    throw new Error(startData.message || startData.error || 'Impossible de démarrer (' + startRes.status + ')')
  }
  const startedAt = Date.now()
  const MAX_MS = 5 * 60 * 1000
  let netErrors = 0
  while (true) {
    if (Date.now() - startedAt > MAX_MS) throw new Error("L'analyse a expiré. Réessaye.")
    await sleep(3000)
    let res, data
    try {
      ;({ res, data } = await fetchJsonT(
        API + '/api/analyze-design/result?id=' + encodeURIComponent(jobId),
        { headers: { Accept: 'application/json' } },
        20000
      ))
    } catch (e) {
      if (++netErrors > 6) throw new Error("Connexion interrompue pendant l'analyse.")
      continue
    }
    netErrors = 0
    if (res.status === 404 || data.status === 'not_found') throw new Error("Session d'analyse expirée. Relance.")
    if (data.status === 'error') throw new Error(data.message || "Échec de l'analyse du design.")
    if (data.status === 'pending' && data.phase && onPhase) onPhase(data.phase)
    if (data.status === 'done' && data.data && data.data.prompts) return data.data
  }
}
// Déclencheur : appelé par refreshActionPersonalized (qui court après chaque upload/retaillage).
// Le parcours ET la recette doivent être chargés — le plan RÉÉCRIT les étapes, il n'a rien à
// réécrire tant que le préréglage n'est pas là (et le résultat serait perdu).
function maybeAnalyzeDesign() {
  if (!state.imageDataUrl || state.needsResize) return
  if (!pState.config || !pState.recipe) return
  if (pAnalysis.inflight || pAnalysis.doneFor === state.imageDataUrl) return
  runDesignAnalysis()
}

/* ---------- Application du plan : le parcours se remplit tout seul ----------
   Le back a lu le design et renvoie QUELS champs demander + QUELLE photo exiger. On reconstruit
   les étapes dans cet ordre : photo → champs retenus → format (toujours dernier, contrat moteur).
   Tout reste éditable ensuite — c'est une proposition, pas un verrou. */
function applyDesignPlan(plan) {
  if (!plan || !pState.config) return null
  const steps = pState.config.steps || []
  const catalogById = (id) => STEP_CATALOG.find((e) => e.id === id)
  const fresh = (id) => {
    const entry = catalogById(id)
    return entry ? JSON.parse(JSON.stringify(entry.step)) : null
  }
  const next = []

  // 1) Étape photo. On REPART de celle en place quand elle existe : elle porte le bloc
  // `examples` (alt/légende) que la publication a besoin de trouver pour y accrocher les
  // images d'exemple — une étape neuve du catalogue n'en a pas.
  let photoStep = null
  if (plan.photo) {
    photoStep = steps.find((s) => s.type === 'photo') || fresh('photo')
    if (photoStep) {
      const p = plan.photo
      const pol = photoStep.photoPolicy || (photoStep.photoPolicy = blankPhotoPolicy())
      pol.subject = p.subject
      pol.framing = p.framing
      if (p.subject === 'group' && p.people) pol.people = { min: p.people.min, max: p.people.max }
      else delete pol.people
      pol.angles = { ...p.angles }
      // Messages client : seul le FR est écrit — les 4 autres langues sont (re)générées à la
      // publication. Garder une vieille traduction serait pire que pas de traduction du tout.
      pol.messages = pol.messages || {}
      if (p.rejectFramingFr) pol.messages.reject_framing = { fr: p.rejectFramingFr }
      else delete pol.messages.reject_framing
      if (p.warnAngleFr) pol.messages.warn_angle = { fr: p.warnAngleFr }
      else delete pol.messages.warn_angle
      // Refus d'angle : sans message par produit, le thème sert un générique inadapté
      // (« une photo de l'arrière de la tête ») sur un poster en pied.
      if (p.rejectAngleFr) pol.messages.angle_mismatch = { fr: p.rejectAngleFr }
      else delete pol.messages.angle_mismatch
      // La consigne de prise de vue du thème dérive de faceAngle : elle suit l'angle 🟢.
      photoStep.faceAngle = perfectAngleOf(photoStep) || 'front'
      // Contrôle automatique activé : c'est lui qui refuse la photo AVANT une génération payée.
      photoStep.photoCheck = true
      photoStep.title = { fr: p.titleFr }
      photoStep.help = { fr: p.helpFr }
      // Légendes des exemples. Celle de la MAUVAISE photo est la seule que l'acheteur lit
      // (celle de la bonne est écrite par le thème d'après l'angle) — et c'était elle qui
      // restait au préréglage famille (« selfie serré ») sur un design solo.
      const ex = (photoStep.examples = photoStep.examples || {})
      ex.good = ex.good || {}
      ex.bad = ex.bad || {}
      if (p.badCaptionFr) ex.bad.caption = { fr: p.badCaptionFr }
      if (p.goodAltFr) ex.good.alt = { fr: p.goodAltFr }
      if (p.badAltFr) ex.bad.alt = { fr: p.badAltFr }
      next.push(photoStep)
    }
  }

  // 2) Champs retenus, dans l'ordre du plan (une étape déjà en place est réutilisée telle quelle).
  for (const id of plan.fields) {
    const entry = catalogById(id)
    if (!entry || entry.step.type === 'photo' || entry.step.type === 'format') continue
    const existing = steps.find((s) => s.name === entry.step.name)
    const step = existing || fresh(id)
    if (step && !next.includes(step)) next.push(step)
  }

  // 3) Format : toujours en dernier (contrat moteur — prix/variantes).
  const format = steps.find((s) => s.type === 'format')
  if (format) next.push(format)

  // Sans étape photo, le consentement n'a plus d'objet (et la config le refuserait autrement).
  if (!photoStep && pState.config.payload && pState.config.payload.extra)
    delete pState.config.payload.extra.consent
  else if (photoStep)
    pState.config.payload = { ...(pState.config.payload || {}), extra: { ...((pState.config.payload || {}).extra || {}), consent: '1' } }

  pState.planAnimals = (plan.animals && plan.animals.kinds) || []
  // Les exemples photo dérivent du design PRÉCÉDENT : ils ne veulent plus rien dire ici.
  pState.photoExamples = { good: null, bad: null }
  pState.config.steps = next
  pState.previewStepName = next[0] && next[0].name
  onConfigChanged() // resynchronise aussi les prénoms de la recette (tokens) sur les étapes
  return photoStep
}
// Résumé d'une ligne pour le retour à Walid (règle UX : pas de bandeau permanent en lecture
// seule — ce qui compte est visible et éditable dans les cartes 3 et 4).
function planSummary(plan, photoStep) {
  const bits = []
  if (photoStep) {
    const a = perfectAngleOf(photoStep)
    bits.push('photo ' + (ANGLE_SHORT_FR[a] || 'libre'))
  }
  for (const id of plan.fields) {
    const entry = STEP_CATALOG.find((e) => e.id === id)
    if (entry) bits.push(entry.label.toLowerCase())
  }
  if (plan.animals && plan.animals.present) bits.push('avec ' + plan.animals.kinds.join(' et '))
  return bits.join(' · ')
}
async function runDesignAnalysis() {
  const design = state.imageDataUrl
  pAnalysis.inflight = true
  pAnalysis.phase = 'plan'
  pAnalysis.failed = null
  renderAnalysisState()
  refreshAction() // la porte de publication reste fermée le temps de l'analyse
  try {
    const steps = ((pState.config && pState.config.steps) || [])
      .filter((s) => s.type !== 'format' && s.type !== 'photo')
      .map((s) => ({ payloadKey: s.payloadKey || s.name, type: s.type, titleFr: t(s.title, 'fr') }))
    // Vocabulaire FERMÉ : le back ne rédige pas d'étape, il CHOISIT dans ce catalogue — les
    // étapes y sont déjà écrites et traduites, rien d'inventé ne peut entrer dans la config.
    const catalog = STEP_CATALOG.filter((e) => e.step.type !== 'photo' && e.step.type !== 'format').map((e) => ({
      id: e.id,
      payloadKey: e.step.payloadKey || e.step.name,
      type: e.step.type,
      titleFr: e.label,
    }))
    const { prompts, plan } = await callAnalyzeDesignJob({ artwork: design, steps, catalog }, (phase) => {
      pAnalysis.phase = phase
      renderAnalysisState()
    })
    // design changé pendant l'analyse -> résultat périmé, le prochain refresh relancera
    if (state.imageDataUrl !== design) return
    pAnalysis.doneFor = design
    // Le parcours d'abord (il fixe les champs), le prompt ensuite (il est écrit pour eux).
    const photoStep = plan ? applyDesignPlan(plan) : null
    if (pState.recipe) {
      pState.recipe.prompt = pState.recipe.prompt || {}
      pState.recipe.prompt.base = prompts.base
      for (const key of ['perPerson', 'replaceTitle', 'addExtra', 'removeExtra']) {
        if (prompts[key]) pState.recipe.prompt[key] = prompts[key]
        else delete pState.recipe.prompt[key]
      }
      // pas de re-render si Walid tape dans la carte 4 (les valeurs y sont au prochain rendu)
      if (!document.activeElement || !document.activeElement.closest('#recipeForm')) renderRecipeForm()
    }
    toast(
      plan
        ? 'Rempli depuis votre design ✓ — ' + planSummary(plan, photoStep) + ' (tout reste modifiable)'
        : 'Prompt écrit depuis votre design ✓ — relis la carte 4 si tu veux',
      'ok'
    )
  } catch (e) {
    // échec ACTÉ pour ce design (pas de boucle de relance sur un service payant) : les valeurs
    // actuelles restent, et l'échec s'AFFICHE sur les cartes avec un bouton réessayer.
    pAnalysis.doneFor = design
    pAnalysis.failed = e.message
    toast('Analyse du design : ' + e.message, 'err')
  } finally {
    pAnalysis.inflight = false
    pAnalysis.phase = null
    renderAnalysisState()
    refreshAction()
  }
}

/* ---------- Porte de publication + barre d'action ---------- */
function personalizedPublishGate() {
  // Pendant l'analyse, c'est ELLE qu'on annonce (et pas sous « Manque : » — rien ne manque, ça
  // travaille). Les autres conditions reviendront dès qu'elle rend la main.
  if (pAnalysis.inflight)
    return { ok: false, hint: '⏳ ' + (ANALYSIS_LABEL[pAnalysis.phase] || ANALYSIS_LABEL.plan) }
  const missing = []
  if (!pState.config) missing.push('config (choisir un preset)')
  else if (!validatePersonalizedConfig().ok) missing.push('config invalide')
  if (!pState.recipe || validateRecipeClient().length) missing.push('recette')
  // Un échec d'analyse ne BLOQUE pas (le produit naît en brouillon, et Gemini indisponible ne
  // doit pas arrêter la boutique) : il s'affiche en gros sur les cartes 3 et 4, avec réessayer.
  if (!state.collection) missing.push('collection')
  if (!state.results.some((r) => !r.proof)) missing.push('≥1 rendu') // la preuve n'en est pas un
  return { ok: missing.length === 0, hint: missing.length ? 'Manque : ' + missing.join(' · ') : 'Prêt à publier' }
}
function refreshActionPersonalized() {
  const info = $('#actionInfo'), btn = $('#publishBtn')
  // le ratio de génération suit l'image : si l'orientation a changé (nouvel upload / retaillage),
  // on resynchronise la recette et son affichage (sans voler le focus si Walid tape dedans)
  if (pState.recipe && pState.recipe.aspect !== recipeAspectFromImage()) {
    pState.recipe.aspect = recipeAspectFromImage()
    if (!document.activeElement || !document.activeElement.closest('#recipeForm')) renderRecipeForm()
  }
  maybeAnalyzeDesign() // nouveau design au bon format -> le prompt s'écrit tout seul
  if (state.needsResize) { info.textContent = "⚠️ Retaille l'image au bon format pour publier"; btn.disabled = true; return }
  const gate = personalizedPublishGate()
  info.textContent = gate.hint
  btn.disabled = !gate.ok || !state.imageDataUrl
}

/* ---------- Payload publish (bloc `personalized`) ---------- */
function buildPersonalizedPublishBlock() {
  // Le back re-valide TOUT (défense en profondeur). Les exemples photo ne partent QUE si la config
  // a réellement une étape photo (sinon fichiers Shopify orphelins, sans step examples.* pour les
  // référencer).
  const hasPhoto = !!(pState.config && (pState.config.steps || []).some((s) => s.type === 'photo'))
  // nom de code : jamais envoyé — le back le génère depuis le titre IA (unicité garantie)
  const cfg = pState.config ? { ...pState.config } : null
  if (cfg) delete cfg.productType
  // ratio de génération : toujours déduit de l'image (aucune décision manuelle)
  if (pState.recipe) pState.recipe.aspect = recipeAspectFromImage()
  return {
    studioConfig: cfg,
    studioRecipe: pState.recipe,
    reference: {
      sameAsDesign: pState.recipeSameAsDesign,
      base64Image: pState.recipeSameAsDesign ? null : pState.styleRef,
    },
    photoExamples: {
      good: hasPhoto && pState.photoExamples.good ? { base64Image: pState.photoExamples.good } : null,
      bad: hasPhoto && pState.photoExamples.bad ? { base64Image: pState.photoExamples.bad } : null,
    },
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
  // garde-fou anti-scroll pour le glisser des étapes (comme #resultsGrid dans app.js)
  const stepsGrid = $('#studioSteps')
  if (stepsGrid) stepsGrid.addEventListener('touchmove', (e) => { if (pdrag && pdrag.armed) e.preventDefault() }, { passive: false })
  // Aucune décision d'entrée : le parcours FAMILLE se charge automatiquement comme base
  // (les étapes s'éditent librement — les autres parcours s'obtiennent en retirant/ajoutant
  // des étapes, ex. supprimer la photo pour un produit 100 % texte).
  loadConfigPreset('famille-lineart')
  $('#studioAddStep').addEventListener('click', openTypePicker)
  $('#recipeVerify').addEventListener('click', runServerVerify)
  $('#studioStepSave').addEventListener('click', saveStepEditor)
  $('#studioStepCancel').addEventListener('click', closeStepEditor)
  $('#studioTypeCancel').addEventListener('click', () => $('#studioTypeOverlay').classList.add('hidden'))
  refreshActionPersonalized()
}
