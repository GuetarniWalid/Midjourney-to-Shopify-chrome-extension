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

// Nom d'étape (contrat moteur)
const STEP_NAME_RE = /^[a-z][a-zA-Z0-9_]*$/
// Collection parente pré-suggérée : « Poster Personnalisé Famille » (modifiable)
const PERSONALIZED_DEFAULT_COLLECTION_GID = '624856400219'
// Langues du studio (l'ordre compte : FR d'abord)
const STUDIO_LANGS = ['fr', 'en', 'de', 'nl', 'es']
const STUDIO_OTHER_LANGS = ['en', 'de', 'nl', 'es']
const LANG_LABELS = { fr: 'Français', en: 'English', de: 'Deutsch', nl: 'Nederlands', es: 'Español' }
// Noms réservés aux panneaux foot (le validateur les bloque si type ≠ attendu)
const STUDIO_RESERVED_PANELS = { photo: 'photo', team: 'choice', name: 'group', format: 'format' }
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

// Maps i18n modifiées après traduction (identité d'objet) -> à retraduire avant publication.
const staleI18n = new WeakSet()

/* ---------- Catalogue d'étapes PRÊTES À L'EMPLOI ----------
   Jamais de type générique : chaque entrée est une étape CONCRÈTE, entièrement préremplie et
   déjà traduite en 5 langues — l'ajout ne demande AUCUNE saisie (modifiable ensuite via ✎). */
const STEP_CATALOG = [
  {
    id: 'photo', icon: '📷', label: 'Photo du client',
    desc: 'Le client envoie sa photo (une seule étape photo possible)',
    step: {
      name: 'photo', type: 'photo', required: true, consent: { required: true }, payloadKey: 'photo',
      title: { fr: 'Votre photo', en: 'Your photo', de: 'Dein Foto', nl: 'Je foto', es: 'Tu foto' },
      checkpointLabel: { fr: 'Photo', en: 'Photo', de: 'Foto', nl: 'Foto', es: 'Foto' },
      faceAngle: 'front', photoCheck: false,
    },
  },
  {
    id: 'familyName', icon: '✏️', label: 'Nom de famille',
    desc: 'Champ texte — ex. « Guetarni »',
    step: {
      name: 'familyName', type: 'text', required: true, maxLength: 24, charset: 'free', payloadKey: 'familyName',
      cartProperty: { label: { fr: 'Nom de famille', en: 'Family name', de: 'Familienname', nl: 'Familienaam', es: 'Apellido' } },
      title: { fr: 'Votre nom de famille', en: 'Your family name', de: 'Dein Familienname', nl: 'Je familienaam', es: 'Tu apellido' },
      label: { fr: 'Nom affiché sous le dessin', en: 'Name shown under the artwork', de: 'Name unter der Zeichnung', nl: 'Naam onder de tekening', es: 'Nombre mostrado bajo el dibujo' },
      placeholder: { fr: 'Ex : Guetarni', en: 'E.g. Guetarni', de: 'z. B. Guetarni', nl: 'Bijv. Guetarni', es: 'Ej.: Guetarni' },
      checkpointLabel: { fr: 'Nom', en: 'Name', de: 'Name', nl: 'Naam', es: 'Apellido' },
    },
  },
  {
    id: 'firstName', icon: '✏️', label: 'Prénom (un seul)',
    desc: 'Champ texte — ex. « Lina »',
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
    id: 'memberNames', icon: '✏️', label: 'Prénoms (liste, dans l’ordre)',
    desc: 'Plusieurs prénoms séparés par des virgules — pour nommer chaque personne',
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
    desc: 'Sélecteur de date — écrite sur le poster',
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
    desc: 'Sélecteur de date — écrite sur le poster',
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
    desc: 'Petit texte libre — ex. une dédicace sous le dessin',
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
  previewLang: 'fr',
  previewStepName: null,
  editing: null, // { index, working } pendant l'édition d'une étape
}
// Ratio de la recette DÉDUIT de l'image (carte 1), comme partout dans l'app :
// portrait -> 3:4, paysage -> 4:3, carré -> 1:1 (pas d'image encore = 3:4, le cas nominal poster).
const recipeAspectFromImage = () =>
  state.orientation === 'landscape' ? '4:3' : state.orientation === 'square' ? '1:1' : '3:4'
const RECIPE_ADVANCED = [
  { key: 'imageRoles', label: 'Rôles des images (image 1 = photo, image 2 = référence)' },
  { key: 'countLine', label: 'Ligne de comptage ({n}, {tokens})' },
  { key: 'replaceTitle', label: 'Remplacement du titre ({from} → {to})' },
  { key: 'addExtra', label: 'Ajouter une personne ({to})' },
  { key: 'removeExtra', label: 'Retirer une personne ({from})' },
]

/* ---------- Helpers i18n ---------- */
const t = (map, lang) => (map && typeof map === 'object' ? map[lang] || map.fr || '' : typeof map === 'string' ? map : '')
const isI18nComplete = (map) =>
  !!map && typeof map === 'object' && STUDIO_LANGS.every((l) => typeof map[l] === 'string' && map[l].trim())
// Assure un chemin `a.b.c` dans un objet et renvoie la map i18n (créée = { fr:'' } si absente).
function ensureI18nMap(root, dotPath) {
  const parts = dotPath.split('.')
  let node = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {}
    node = node[parts[i]]
  }
  const leaf = parts[parts.length - 1]
  if (!node[leaf] || typeof node[leaf] !== 'object' || Array.isArray(node[leaf])) node[leaf] = { fr: '' }
  return node[leaf]
}
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
// Supprime la feuille au chemin donné (pour élaguer une map i18n devenue vide).
function deleteAtPath(root, dotPath) {
  const parts = dotPath.split('.')
  let node = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node || typeof node !== 'object') return
    node = node[parts[i]]
  }
  if (node && typeof node === 'object') delete node[parts[parts.length - 1]]
}
const i18nMapEmpty = (map) => !map || STUDIO_LANGS.every((l) => !(typeof map[l] === 'string' && map[l].trim()))
// Élague les maps i18n ENTIÈREMENT vides (l'ouverture de l'éditeur en crée pour les champs
// optionnels via ensureI18nMap). Une map partiellement remplie (FR seul) est CONSERVÉE -> elle
// déclenche la règle des 5 langues, ce qui est voulu.
function pruneEmptyI18nMaps(step) {
  const paths = [
    'title', 'checkpointLabel', 'label', 'placeholder', 'help', 'cartProperty.label',
    'examples.good.alt', 'examples.bad.alt', 'examples.bad.caption',
    'photoPolicy.messages.warn_angle', 'photoPolicy.messages.reject_framing',
  ]
  for (const p of paths) {
    const map = getI18nMap(step, p)
    if (map && i18nMapEmpty(map)) deleteAtPath(step, p)
  }
}

/* ---------- Champs i18n par type d'étape ---------- */
// Renvoie la liste des champs i18n éditables d'une étape : { path, label, kind:'line'|'multiline' }.
function i18nFieldsOf(step) {
  const fields = [
    { path: 'title', label: 'Titre de l’étape', kind: 'line' },
    { path: 'checkpointLabel', label: 'Pastille (parcours)', kind: 'line' },
  ]
  if (step.type === 'text' || step.type === 'number' || step.type === 'date') {
    fields.push({ path: 'label', label: 'Libellé du champ', kind: 'line' })
    if (step.type === 'text') fields.push({ path: 'placeholder', label: 'Exemple (placeholder)', kind: 'line' })
    fields.push({ path: 'help', label: 'Aide (optionnel)', kind: 'multiline' })
    if (step.cartProperty)
      fields.push({ path: 'cartProperty.label', label: 'Libellé sur la ligne de commande', kind: 'line' })
  }
  if (step.type === 'photo') {
    fields.push({ path: 'examples.good.alt', label: 'Alt — bonne photo', kind: 'multiline' })
    fields.push({ path: 'examples.bad.alt', label: 'Alt — photo à éviter', kind: 'multiline' })
    fields.push({ path: 'examples.bad.caption', label: 'Légende — photo à éviter', kind: 'line' })
    if (step.photoPolicy) {
      fields.push({ path: 'photoPolicy.messages.warn_angle', label: 'Message 🟡 (angle accepté)', kind: 'multiline' })
      fields.push({ path: 'photoPolicy.messages.reject_framing', label: 'Message 🔴 (cadrage refusé)', kind: 'multiline' })
    }
  }
  return fields
}
// Toutes les maps i18n PRÉSENTES d'une étape (lecture seule, pour validation/traduction).
function existingI18nMaps(step) {
  const out = []
  const consider = [
    'title', 'checkpointLabel', 'label', 'placeholder', 'help', 'cartProperty.label',
    'examples.good.alt', 'examples.bad.alt', 'examples.bad.caption',
    'photoPolicy.messages.warn_angle', 'photoPolicy.messages.reject_framing',
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
    $('#studioTranslateWrap').classList.remove('hidden')
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

  // 2) règle builder : 5 langues sur toute map i18n présente
  for (const step of cfg.steps || []) {
    for (const { path, map } of existingI18nMaps(step)) {
      const missing = STUDIO_LANGS.filter((l) => !(typeof map[l] === 'string' && map[l].trim()))
      if (missing.length)
        (byStep.get(step.name) || byStep.set(step.name, []).get(step.name)).push(
          `${path} : langue(s) manquante(s) — ${missing.join(', ')} (les 5 langues sont obligatoires).`
        )
      else if (staleI18n.has(map))
        (byStep.get(step.name) || byStep.set(step.name, []).get(step.name)).push(
          `${path} : traduction obsolète après modification du français — retraduire.`
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
    cell.innerHTML =
      `<span class="ss-icon">${meta.icon}</span>` +
      `<span class="ss-main"><span class="ss-name">${escapeHtml(step.name)}</span>` +
      `<span class="ss-sub">${escapeHtml(step.type)}${step.title ? ' · ' + escapeHtml(t(step.title, 'fr')) : ''}</span></span>` +
      `<span class="ss-badge ${errs.length ? 'err' : 'ok'}">${errs.length ? '✗ ' + errs.length : '✓'}</span>` +
      `<span class="ss-actions">` +
      `<button class="ss-act ss-edit" title="Modifier">✎</button>` +
      `<button class="ss-act ss-dup" title="Dupliquer"${step.type === 'photo' ? ' disabled' : ''}>⧉</button>` +
      `<button class="ss-act danger ss-del" title="Supprimer">🗑</button>` +
      `</span>`
    cell.querySelector('.ss-edit').addEventListener('click', (e) => { e.stopPropagation(); openStepEditor(i) })
    cell.querySelector('.ss-dup').addEventListener('click', (e) => { e.stopPropagation(); duplicateStep(i) })
    cell.querySelector('.ss-del').addEventListener('click', (e) => { e.stopPropagation(); deleteStep(i) })
    attachStepDrag(cell)
    wrap.appendChild(cell)
  })
  // photo max 1 : grise le choix photo dans l'ajout (géré à l'ouverture du picker)
  $('#studioAddStep').dataset.photoFull = photoCount >= 1 ? '1' : ''
}

/* ---------- Rendu : résumé de validation ---------- */
function renderStudioValidation() {
  const box = $('#studioValidation')
  if (!pState.config) { box.classList.add('hidden'); return }
  const v = validatePersonalizedConfig()
  box.classList.remove('hidden')
  const stepErrs = [...v.byStep.values()].reduce((n, a) => n + a.length, 0)
  if (v.ok) {
    box.className = 'studio-validation ok'
    box.innerHTML = `✓ Configuration valide — les 5 langues sont présentes.` +
      (v.warnings.length ? `<div class="sv-warn">${v.warnings.length} avertissement(s) non bloquant(s).</div>` : '')
  } else {
    box.className = 'studio-validation err'
    const items = [...v.rootErrors]
    for (const [name, errs] of v.byStep) for (const e of errs) items.push(`« ${name} » — ${e.replace(/^step "[^"]+"\.?/, '')}`)
    box.innerHTML = `✗ ${v.rootErrors.length + stepErrs} erreur(s) à corriger avant publication :` +
      `<ul>${items.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` +
      (items.length > 12 ? `<div>… et ${items.length - 12} autre(s).</div>` : '')
  }
  const badge = $('#studioBadge')
  // compte AFFICHÉ = étapes visibles (l'étape format, gérée en coulisses, n'est pas comptée)
  const visibleCount = pState.config.steps.filter((s) => s.type !== 'format').length
  badge.textContent = v.ok ? `${visibleCount} étapes · valide ✓` : `${stepErrs + v.rootErrors.length} erreur(s)`
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
  r.judge = r.judge || {}
  const inputSteps = configInputSteps()
  const tokFrom = (r.inputs.tokens && r.inputs.tokens.from) || ''
  const P = []

  // Moteur : PAS d'UI — mêmes réglages pour tous les produits. Le ratio est déduit de l'image
  // (carte 1) ; modèle/versions/essais gardent les défauts du preset (gemini-3-pro-image, 3, 2).
  r.aspect = recipeAspectFromImage()

  // Entrées (mapping auto depuis la config)
  P.push('<div class="studio-sub"><p class="studio-sub-title">Entrées (depuis les étapes)</p>')
  P.push(`<p class="sf-help">Champs de la config : ${inputSteps.map((s) => escapeHtml(s.key)).join(', ') || '—'}</p>`)
  const tokKeys = inputSteps.filter((s) => s.type === 'text').map((s) => s.key)
  // préserve tokFrom même si la config n'est pas (encore) chargée / ne contient pas ce champ :
  // sinon le <select> retomberait sur "" et un ré-render effacerait inputs.tokens du preset.
  if (tokFrom && !tokKeys.includes(tokFrom)) tokKeys.unshift(tokFrom)
  const tokOpts = ['<option value="">Aucun (pas de prénoms multiples)</option>']
    .concat(tokKeys.map((k) => `<option value="${escapeHtml(k)}"${tokFrom === k ? ' selected' : ''}>${escapeHtml(k)}${configInputSteps().some((s) => s.key === k) ? '' : ' (hors config)'}</option>`))
  // « Max prénoms » SYNCHRONISÉ sur « Personnes max » du juge photo (une seule source de vérité :
  // la validation exige de toute façon l'égalité — autant la faire automatiquement).
  const photoStepCfg = pState.config && (pState.config.steps || []).find((s) => s.type === 'photo')
  const peopleMaxCfg = photoStepCfg && photoStepCfg.photoPolicy && photoStepCfg.photoPolicy.people && photoStepCfg.photoPolicy.people.max
  if (typeof peopleMaxCfg === 'number' && r.inputs.tokens) r.inputs.tokens.max = peopleMaxCfg
  const tokMaxLocked = typeof peopleMaxCfg === 'number'
  P.push(`<div class="studio-row">
    ${fieldBlock('Prénoms depuis (tokens.from)', 'Champ texte découpé en prénoms.', `<select data-recipe-tokens="from">${tokOpts.join('')}</select>`)}
    ${fieldBlock('Max prénoms (1-8)', tokMaxLocked ? '= « Personnes max » du juge photo (synchronisé automatiquement).' : 'Nombre max de prénoms nommables sur le dessin.', `<input type="number" data-recipe-tokens="max" min="1" max="8" value="${(r.inputs.tokens && r.inputs.tokens.max) ?? 6}"${tokMaxLocked ? ' disabled' : ''}>`)}
  </div>`)
  P.push(fieldBlock('Titre (template)', 'Ex : La famille {familyName}. Les {champs} viennent de la config.',
    `<input type="text" data-recipe-title="template" value="${escapeHtml((r.inputs.title && r.inputs.title.template) || '')}">`))
  P.push('</div>')

  // Référence de style
  P.push('<div class="studio-sub"><p class="studio-sub-title">Référence de style</p>')
  P.push(`<label class="studio-check"><input type="checkbox" id="rf-sameAsDesign" ${pState.recipeSameAsDesign ? 'checked' : ''}> Le design d’exemple (carte 1) EST la référence</label>`)
  P.push(`<div id="rf-upload" class="${pState.recipeSameAsDesign ? 'hidden' : ''}">
    ${fieldBlock('Image de référence', 'Image de style écrite (titre + slots).', `<input type="file" accept="image/*" id="rf-styleRef" class="decor-vibe">`)}
    <div class="photo-ex-slot"><img id="rf-styleRef-img" src="${pState.styleRef || ''}" alt="" ${pState.styleRef ? '' : 'style="min-height:80px"'}></div>
  </div>`)
  P.push(fieldBlock('Titre écrit sur la référence', 'Ex : The Smith Family (source de la substitution du titre).',
    `<input type="text" data-recipe="reference.texts.title" value="${escapeHtml(r.reference.texts.title || '')}">`))
  P.push(fieldBlock('Textes-slots (séparés par des virgules)', 'Ex : DADDY, FRANCO, MOMMY, VERONICA.',
    `<input type="text" id="rf-slots" value="${escapeHtml((r.reference.texts.slots || []).join(', '))}">`))
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

  // Juge
  P.push('<div class="studio-sub"><p class="studio-sub-title">Contrôle qualité automatique</p>')
  P.push(`<p class="sf-help">Avant de montrer le résultat au client, l'IA vérifie chaque version générée. Laisser coché.</p>`)
  P.push(`<label class="studio-check"><input type="checkbox" data-recipe-judge="text" ${r.judge.text !== false ? 'checked' : ''}> Vérifier que les prénoms/titre sont bien écrits</label>`)
  P.push(`<label class="studio-check"><input type="checkbox" data-recipe-judge="figureCount" ${r.judge.figureCount !== false ? 'checked' : ''}> Vérifier le nombre de personnes dessinées</label>`)
  P.push('</div>')

  wrap.innerHTML = P.join('')
  wireRecipeEvents()
  renderRecipeValidation()
}
function wireRecipeEvents() {
  // champs simples liés à un chemin
  $$('#recipeForm [data-recipe]').forEach((el) =>
    el.addEventListener('input', () => {
      const path = el.dataset.recipe
      let v = el.value
      if (path === 'candidates' || path === 'maxAttempts') v = parseInt(v, 10) || 0
      if (path === 'reference.texts.title') v = v.trim() || null
      setRecipePath(path, v)
      renderRecipeValidation()
      refreshAction()
    })
  )
  // tokens (from/max) — structure inputs.tokens
  $$('#recipeForm [data-recipe-tokens]').forEach((el) =>
    el.addEventListener('input', () => {
      const r = pState.recipe
      const from = $('#recipeForm [data-recipe-tokens="from"]').value
      const maxEl = $('#recipeForm [data-recipe-tokens="max"]')
      if (!from) { if (r.inputs) delete r.inputs.tokens }
      else r.inputs.tokens = { from, split: true, max: parseInt(maxEl.value, 10) || 6 }
      renderRecipeValidation(); refreshAction()
    })
  )
  // titre (inputs.title.template)
  const titleEl = $('#recipeForm [data-recipe-title="template"]')
  if (titleEl) titleEl.addEventListener('input', () => {
    const tpl = titleEl.value.trim()
    if (!tpl) delete pState.recipe.inputs.title
    else pState.recipe.inputs.title = { template: tpl, required: true }
    renderRecipeValidation(); refreshAction()
  })
  // slots
  const slotsEl = $('#rf-slots')
  if (slotsEl) slotsEl.addEventListener('input', () => {
    pState.recipe.reference.texts.slots = slotsEl.value.split(',').map((s) => s.trim()).filter(Boolean)
  })
  // juge
  $$('#recipeForm [data-recipe-judge]').forEach((el) =>
    el.addEventListener('change', () => { pState.recipe.judge[el.dataset.recipeJudge] = el.checked })
  )
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
  if (!(r.prompt && r.prompt.base && r.prompt.base.trim())) errs.push('prompt.base est obligatoire.')
  const c = r.candidates
  if (!(Number.isInteger(c) && c >= 1 && c <= 4)) errs.push('candidates doit être entre 1 et 4.')
  const m = r.maxAttempts
  if (!(Number.isInteger(m) && m >= 1 && m <= 3)) errs.push('maxAttempts doit être entre 1 et 3.')
  if (r.inputs && r.inputs.tokens) {
    const tm = r.inputs.tokens.max
    if (!(Number.isInteger(tm) && tm >= 1 && tm <= 8)) errs.push('tokens.max doit être entre 1 et 8.')
  }
  if (r.inputs && r.inputs.title && !(r.reference && r.reference.texts && r.reference.texts.title))
    errs.push('Un titre (template) est configuré : renseigne « Titre écrit sur la référence ».')
  // cohérence recette ↔ config (clés d'entrée = payloadKey des étapes non-format)
  if (pState.config) {
    const inputKeys = new Set(configInputSteps().map((s) => s.key))
    // tokens.max ↔ photoPolicy.people.max
    if (r.inputs && r.inputs.tokens) {
      const photo = pState.config.steps.find((s) => s.type === 'photo')
      const pm = photo && photo.photoPolicy && photo.photoPolicy.people && photo.photoPolicy.people.max
      if (typeof pm === 'number' && r.inputs.tokens.max !== pm)
        errs.push(`tokens.max (${r.inputs.tokens.max}) doit égaler photoPolicy.people.max (${pm}).`)
      // tokens.from doit pointer vers une étape existante (sinon découpage prénoms cassé à la commande)
      if (r.inputs.tokens.from && !inputKeys.has(r.inputs.tokens.from))
        errs.push(`« Prénoms depuis » (${r.inputs.tokens.from}) ne correspond à aucune étape — corrige le mapping.`)
    }
    // chaque {champ} du template de titre doit pointer vers une étape existante
    const tpl = r.inputs && r.inputs.title && r.inputs.title.template
    if (tpl) {
      for (const m2 of String(tpl).matchAll(/\{([^{}]+)\}/g))
        if (!inputKeys.has(m2[1])) errs.push(`Le champ « {${m2[1]}} » du titre ne correspond à aucune étape.`)
    }
  }
  // référence obligatoire
  if (!pState.recipeSameAsDesign && !pState.styleRef) errs.push('Image de référence obligatoire (ou coche « le design est la référence »).')
  return errs
}
function renderRecipeValidation() {
  const box = $('#recipeValidation')
  const badge = $('#recipeBadge')
  if (!pState.recipe) { box.classList.add('hidden'); return }
  const errs = validateRecipeClient()
  box.classList.remove('hidden')
  if (!errs.length) {
    box.className = 'studio-validation ok'
    box.innerHTML = '✓ Recette valide.'
    badge.textContent = 'recette valide ✓'
  } else {
    box.className = 'studio-validation err'
    box.innerHTML = `✗ ${errs.length} problème(s) :<ul>${errs.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
    badge.textContent = `${errs.length} problème(s)`
  }
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

/* ---------- Éditeur d'étape (overlay) ---------- */
function openStepEditor(index) {
  const step = pState.config.steps[index]
  pState.editing = { index, working: JSON.parse(JSON.stringify(step)) }
  $('#studioStepTitle').textContent = `Modifier « ${step.name} » (${step.type})`
  renderStepEditorBody()
  $('#studioStepOverlay').classList.remove('hidden')
}
function closeStepEditor() {
  $('#studioStepOverlay').classList.add('hidden')
  pState.editing = null
}
// Construit un bloc « champ simple » (input/select/textarea) piloté par un getter/setter.
function fieldBlock(label, help, controlHtml) {
  return `<div class="studio-field"><label>${escapeHtml(label)}</label>${controlHtml}${help ? `<p class="sf-help">${escapeHtml(help)}</p>` : ''}</div>`
}
// Bloc champ i18n : FR visible + repli des 4 autres langues + badge d'état.
function i18nBlock(field, map) {
  const complete = isI18nComplete(map)
  const stale = staleI18n.has(map)
  const badge = complete && !stale
    ? '<span class="i18n-badge ok">5 langues ✓</span>'
    : stale
      ? '<span class="i18n-badge warn">FR modifié — retraduire</span>'
      : '<span class="i18n-badge warn">FR seul</span>'
  const ctrl = (lang) =>
    field.kind === 'multiline'
      ? `<textarea data-i18n="${escapeHtml(field.path)}" data-lang="${lang}">${escapeHtml(map[lang] || '')}</textarea>`
      : `<input type="text" data-i18n="${escapeHtml(field.path)}" data-lang="${lang}" value="${escapeHtml(map[lang] || '')}">`
  const others = STUDIO_OTHER_LANGS.map(
    (l) => `<div class="i18n-lang"><label>${LANG_LABELS[l]}</label>${ctrl(l)}</div>`
  ).join('')
  return `<div class="i18n-field" data-i18n-field="${escapeHtml(field.path)}">
    <div class="i18n-head"><label>${escapeHtml(field.label)}</label>${badge}</div>
    ${ctrl('fr')}
    <button type="button" class="i18n-toggle" data-i18n-toggle>▾ Voir les 4 autres langues</button>
    <div class="i18n-others hidden">${others}</div>
  </div>`
}
function renderStepEditorBody() {
  const s = pState.editing.working
  const body = $('#studioStepBody')
  const parts = []
  const nameReserved = s.type !== 'photo' && s.type !== 'format'
  // nom + payloadKey
  if (s.type === 'photo' || s.type === 'format') {
    parts.push(fieldBlock('Nom technique (name)', 'Fixé par convention pour ce type.',
      `<input type="text" value="${escapeHtml(s.name)}" disabled>`))
  } else {
    parts.push(fieldBlock('Nom technique (name)', 'Identifiant unique — minuscules/chiffres/_ (ex : coupleName).',
      `<input type="text" id="sf-name" value="${escapeHtml(s.name)}"><p class="sf-err hidden" id="sf-name-err"></p>`))
  }
  if (s.type !== 'format')
    parts.push(fieldBlock('Clé back-end (payloadKey)', 'Nom du champ transmis au back-end (défaut = name).',
      `<input type="text" id="sf-payloadKey" value="${escapeHtml(s.payloadKey || '')}" placeholder="${escapeHtml(s.name)}">`))
  // required
  parts.push(`<label class="studio-check"><input type="checkbox" id="sf-required" ${s.required !== false ? 'checked' : ''}> Étape obligatoire</label>`)

  // options par type
  if (s.type === 'text') {
    parts.push(`<div class="studio-row">
      ${fieldBlock('Longueur max', '', `<input type="number" id="sf-maxLength" min="1" value="${s.maxLength || ''}">`)}
      ${fieldBlock('Transformation', '', `<select id="sf-transform"><option value="none"${(s.transform || 'none') === 'none' ? ' selected' : ''}>Aucune</option><option value="uppercase"${s.transform === 'uppercase' ? ' selected' : ''}>MAJUSCULES</option></select>`)}
      ${fieldBlock('Caractères', '', `<select id="sf-charset"><option value="free"${(s.charset || 'free') === 'free' ? ' selected' : ''}>Libres</option><option value="letters"${s.charset === 'letters' ? ' selected' : ''}>Lettres seules</option></select>`)}
    </div>`)
  }
  if (s.type === 'number') {
    parts.push(`<div class="studio-row">
      ${fieldBlock('Min', '', `<input type="number" id="sf-min" value="${s.min ?? ''}">`)}
      ${fieldBlock('Max', '', `<input type="number" id="sf-max" value="${s.max ?? ''}">`)}
    </div>`)
  }
  if (s.type === 'date') {
    parts.push(fieldBlock('Mode', 'Le moteur ne distingue que date et heure.',
      `<select id="sf-mode"><option value="date"${(s.mode || 'date') === 'date' ? ' selected' : ''}>Date</option><option value="time"${s.mode === 'time' ? ' selected' : ''}>Heure</option></select>`))
  }
  // cartProperty (text/number/date)
  if (s.type === 'text' || s.type === 'number' || s.type === 'date') {
    parts.push(`<label class="studio-check"><input type="checkbox" id="sf-cartProp" ${s.cartProperty ? 'checked' : ''}> Afficher sur la ligne de commande</label>`)
  }

  // photo : consent + juge + policy + exemples
  if (s.type === 'photo') {
    parts.push(`<label class="studio-check"><input type="checkbox" id="sf-consent" ${s.consent && s.consent.required !== false ? 'checked' : ''}> Consentement requis (photo de personnes)</label>`)
    parts.push(`<label class="studio-check"><input type="checkbox" id="sf-photoCheck" ${s.photoCheck ? 'checked' : ''}> Activer le contrôle photo (juge)</label>`)
    parts.push(renderPhotoPolicyEditor(s))
    parts.push(renderPhotoExamplesEditor(s))
  }

  // format : rôles figés (lecture seule)
  if (s.type === 'format') {
    parts.push(`<div class="studio-sub"><p class="studio-sub-title">Rôles (figés)</p>
      <p class="sf-help">size → format (dimensions) · frame → frame (slug). Forme imposée par le moteur — non éditable.</p></div>`)
  }

  // champs i18n
  parts.push('<div class="studio-sub"><p class="studio-sub-title">Libellés (5 langues)</p>')
  for (const f of i18nFieldsOf(s)) {
    // cartProperty.label n'existe que si la case est cochée
    if (f.path === 'cartProperty.label' && !s.cartProperty) continue
    parts.push(i18nBlock(f, ensureI18nMap(s, f.path)))
  }
  parts.push('</div>')

  body.innerHTML = parts.join('')
  wireStepEditorEvents()
}
function renderPhotoPolicyEditor(s) {
  const pol = s.photoPolicy || null
  if (!pol) {
    return `<div class="studio-sub"><p class="studio-sub-title">Juge photo</p>
      <p class="sf-help">Aucune politique définie. Activez le contrôle photo puis rechargez le preset famille pour une base.</p></div>`
  }
  const angleRows = PHOTO_ANGLES.map((a) => {
    const cur = (pol.angles && pol.angles[a.key]) || 'warn'
    const opts = PHOTO_GRADES.map((g) =>
      `<button type="button" class="angle-opt ${cur === g.key ? 'on' : ''}" data-angle="${a.key}" data-grade="${g.key}" title="${g.fr}">${g.icon}</button>`
    ).join('')
    return `<div class="angle-row"><span class="angle-name">${a.fr}</span><span class="angle-opts">${opts}</span></div>`
  }).join('')
  const isGroup = pol.subject === 'group'
  return `<div class="studio-sub" id="sf-policy">
    <p class="studio-sub-title">Juge photo (photoPolicy)</p>
    <div class="studio-row">
      ${fieldBlock('Sujet', '', `<select id="sf-pol-subject"><option value="person"${!isGroup ? ' selected' : ''}>Une personne</option><option value="group"${isGroup ? ' selected' : ''}>Un groupe</option></select>`)}
      ${fieldBlock('Cadrage', '', `<select id="sf-pol-framing"><option value="face"${pol.framing !== 'full-body' ? ' selected' : ''}>Visage</option><option value="full-body"${pol.framing === 'full-body' ? ' selected' : ''}>En pied</option></select>`)}
    </div>
    <div class="studio-row" id="sf-pol-people" ${isGroup ? '' : 'style="display:none"'}>
      ${fieldBlock('Personnes min', '', `<input type="number" id="sf-pol-min" min="1" value="${(pol.people && pol.people.min) ?? 1}">`)}
      ${fieldBlock('Personnes max', 'Doit égaler recette tokens.max si les deux existent.', `<input type="number" id="sf-pol-max" min="1" value="${(pol.people && pol.people.max) ?? 6}">`)}
    </div>
    <p class="sf-help">Angle détecté → grade (🟢 parfait / 🟡 accepté / 🔴 refusé). L’angle « parfait » devient la consigne photo (faceAngle).</p>
    <div class="angle-grid">${angleRows}</div>
  </div>`
}
function renderPhotoExamplesEditor(s) {
  const goodSrc = pState.photoExamples.good || null
  const badSrc = pState.photoExamples.bad || null
  const slot = (kind, src, label) =>
    `<div class="photo-ex-slot">
      <label>${label}</label>
      <img id="sf-ex-${kind}-img" src="${src || ''}" alt="" ${src ? '' : 'style="min-height:90px"'}>
      <input type="file" accept="image/*" id="sf-ex-${kind}" class="decor-vibe">
    </div>`
  return `<div class="studio-sub"><p class="studio-sub-title">Exemples photo</p>
    <p class="sf-help">Images envoyées dans Shopify Files à la publication. Les Alt/légendes (i18n) sont plus bas.</p>
    <div class="photo-ex">${slot('good', goodSrc, 'Bonne photo')}${slot('bad', badSrc, 'Photo à éviter')}</div>
  </div>`
}
// Câble les events du corps de l'éditeur (une fois rendu).
function wireStepEditorEvents() {
  const s = pState.editing.working
  // repli des langues
  $$('#studioStepBody [data-i18n-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const others = btn.parentElement.querySelector('.i18n-others')
      const hidden = others.classList.toggle('hidden')
      btn.textContent = hidden ? '▾ Voir les 4 autres langues' : '▴ Masquer les autres langues'
    })
  )
  // saisie i18n -> mutation de la map ; FR modifié = map stale (retraduire)
  $$('#studioStepBody [data-i18n]').forEach((inp) =>
    inp.addEventListener('input', () => {
      const map = ensureI18nMap(s, inp.dataset.i18n)
      const lang = inp.dataset.lang
      map[lang] = inp.value
      if (lang === 'fr') { if (!isI18nComplete(map)) {} else staleI18n.add(map) }
      else staleI18n.delete(map) // correction manuelle d'une autre langue -> plus obsolète
      // rafraîchit le badge de CE champ
      const field = inp.closest('.i18n-field')
      const badge = field.querySelector('.i18n-badge')
      const complete = isI18nComplete(map), stale = staleI18n.has(map)
      badge.className = 'i18n-badge ' + (complete && !stale ? 'ok' : 'warn')
      badge.textContent = complete && !stale ? '5 langues ✓' : stale ? 'FR modifié — retraduire' : 'FR seul'
    })
  )
  // nom : validation live (regex + réservé + unicité)
  const nameInp = $('#sf-name')
  if (nameInp) nameInp.addEventListener('input', validateEditorName)
  // cartProperty : re-render (fait apparaître/disparaître le libellé i18n)
  const cartCb = $('#sf-cartProp')
  if (cartCb) cartCb.addEventListener('change', () => { collectSimpleFields(); s.cartProperty = cartCb.checked ? (s.cartProperty || { label: { fr: '' } }) : undefined; if (!cartCb.checked) delete s.cartProperty; renderStepEditorBody() })
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
  // exemples photo (base64 en attente)
  for (const kind of ['good', 'bad']) {
    const inp = $(`#sf-ex-${kind}`)
    if (!inp) continue
    inp.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0]
      if (!f || !f.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => { pState.photoExamples[kind] = reader.result; $(`#sf-ex-${kind}-img`).src = reader.result }
      reader.readAsDataURL(f)
    })
  }
}
function validateEditorName() {
  const inp = $('#sf-name')
  const err = $('#sf-name-err')
  const s = pState.editing.working
  const name = inp.value.trim()
  let msg = ''
  if (!STEP_NAME_RE.test(name)) msg = 'Format : commence par une minuscule, puis lettres/chiffres/_.'
  else if (name in STUDIO_RESERVED_PANELS && STUDIO_RESERVED_PANELS[name] !== s.type)
    msg = `« ${name} » est réservé au panneau foot "${name}" (type ${STUDIO_RESERVED_PANELS[name]}). Renomme (ex : ${name}Field).`
  else if (pState.config.steps.some((st, i) => i !== pState.editing.index && st.name === name))
    msg = 'Ce nom est déjà utilisé par une autre étape.'
  inp.classList.toggle('invalid', !!msg)
  err.textContent = msg
  err.classList.toggle('hidden', !msg)
  return !msg
}
// Lit les champs simples (hors i18n) du DOM vers l'objet working.
function collectSimpleFields() {
  const s = pState.editing.working
  const val = (id) => { const el = $(id); return el ? el.value : undefined }
  const num = (id) => { const v = val(id); return v === '' || v == null ? undefined : parseInt(v, 10) }
  if ($('#sf-name')) s.name = val('#sf-name').trim()
  if ($('#sf-payloadKey') != null && s.type !== 'format') {
    const pk = ($('#sf-payloadKey').value || '').trim()
    if (pk) s.payloadKey = pk; else delete s.payloadKey
  }
  if ($('#sf-required')) s.required = $('#sf-required').checked
  if (s.type === 'text') {
    const ml = num('#sf-maxLength'); if (ml) s.maxLength = ml; else delete s.maxLength
    s.transform = val('#sf-transform') || 'none'
    s.charset = val('#sf-charset') || 'free'
  }
  if (s.type === 'number') {
    const mn = num('#sf-min'), mx = num('#sf-max')
    if (mn != null) s.min = mn; else delete s.min
    if (mx != null) s.max = mx; else delete s.max
  }
  if (s.type === 'date') s.mode = val('#sf-mode') || 'date'
  if (s.type === 'photo') {
    if ($('#sf-consent')) s.consent = { required: $('#sf-consent').checked }
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
      // faceAngle déduit = angle « parfait » (repli front)
      const perfect = Object.entries(angles).find(([, g]) => g === 'perfect')
      s.faceAngle = perfect ? perfect[0] : 'front'
    }
  }
}
function saveStepEditor() {
  if ($('#sf-name') && !validateEditorName()) return toast('Corrige le nom de l’étape.', 'err')
  collectSimpleFields()
  pruneEmptyI18nMaps(pState.editing.working) // retire les maps optionnelles restées vides
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
  list.innerHTML =
    '<p class="card-note">Tout est prérempli et déjà traduit en 5 langues — modifiable ensuite via ✎.</p>' +
    STEP_CATALOG.map((entry, i) => {
      const dis = entry.step.type === 'photo' && photoFull
      return `<button class="section-opt" data-catalog="${i}" ${dis ? 'disabled' : ''}>
      <span>${entry.icon} ${escapeHtml(entry.label)}${dis ? ' — déjà présente' : ''}<span class="st-desc"> ${escapeHtml(entry.desc)}</span></span></button>`
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
function duplicateStep(index) {
  const src = pState.config.steps[index]
  if (src.type === 'format' || src.type === 'photo') return
  const copy = JSON.parse(JSON.stringify(src))
  copy.name = uniqueStepName(src.name)
  copy.payloadKey = copy.name
  pState.config.steps.splice(index + 1, 0, copy)
  onConfigChanged()
  toast('Étape dupliquée ✓', 'ok')
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

/* ---------- Traduction FR -> 4 langues (endpoint back, P3) ---------- */
async function translateAll() {
  if (!pState.config) return
  // maps à traduire : incomplètes OU obsolètes, avec un FR non vide
  const targets = []
  for (const step of pState.config.steps) {
    for (const { map } of existingI18nMaps(step)) {
      const frOk = typeof map.fr === 'string' && map.fr.trim()
      if (frOk && (!isI18nComplete(map) || staleI18n.has(map))) targets.push(map)
    }
  }
  if (!targets.length) return toast('Rien à traduire — tout est déjà à jour.', 'ok')
  const btn = $('#studioTranslateAll')
  const hint = $('#studioTranslateHint')
  btn.disabled = true
  hint.textContent = `Traduction de ${targets.length} libellé(s)…`
  try {
    const items = targets.map((map, i) => ({ id: String(i), fr: map.fr }))
    const r = await fetch(API + '/api/shopify-product-publisher/translate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items }),
    })
    const data = await safeJson(r)
    if (!r.ok || !data.success || !Array.isArray(data.items)) {
      throw new Error(r.status === 401 ? 'session expirée — reconnecte-toi' : data.message || data.error || 'échec (' + r.status + ')')
    }
    for (const it of data.items) {
      const map = targets[parseInt(it.id, 10)]
      if (!map) continue
      for (const l of STUDIO_OTHER_LANGS) if (typeof it[l] === 'string') map[l] = it[l]
      staleI18n.delete(map)
    }
    hint.textContent = ''
    toast('Traduction terminée ✓', 'ok')
    // si l'éditeur est ouvert, rafraîchit ses badges/inputs
    if (pState.editing) renderStepEditorBody()
    onConfigChanged()
  } catch (e) {
    hint.textContent = ''
    toast('Traduction : ' + e.message, 'err')
  } finally {
    btn.disabled = false
  }
}

/* ---------- Aperçu du parcours client ---------- */
function renderStudioPreview() {
  const wrap = $('#studioPreviewWrap')
  if (!pState.config) { wrap.classList.add('hidden'); return }
  wrap.classList.remove('hidden')
  const lang = pState.previewLang
  // onglets langues
  $('#studioPreviewLangs').innerHTML = STUDIO_LANGS.map(
    (l) => `<button class="${l === lang ? 'on' : ''}" data-lang="${l}">${l}</button>`
  ).join('')
  $$('#studioPreviewLangs button').forEach((b) =>
    b.addEventListener('click', () => { pState.previewLang = b.dataset.lang; renderStudioPreview() })
  )
  // stepper
  const steps = pState.config.steps
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
      if (good) parts.push(`<div class="sp-ex"><img src="${good}" alt=""><span>✅ ${escapeHtml(t(getI18nMap(step, 'examples.good.alt'), lang))}</span></div>`)
      if (bad) parts.push(`<div class="sp-ex bad"><img src="${bad}" alt=""><span>⛔ ${escapeHtml(t(getI18nMap(step, 'examples.bad.caption'), lang))}</span></div>`)
      parts.push('</div>')
    }
  } else if (step.type === 'format') {
    parts.push(`<div class="sp-field"><label>${escapeHtml(t(step.title, lang))}</label><div class="sp-fake">Taille (30x40 / 60x80) · Cadre</div></div>`)
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

/* ---------- Porte de publication + barre d'action ---------- */
function personalizedPublishGate() {
  const missing = []
  if (!pState.config) missing.push('config (choisir un preset)')
  else if (!validatePersonalizedConfig().ok) missing.push('config invalide')
  if (!pState.recipe || validateRecipeClient().length) missing.push('recette')
  if (!state.collection) missing.push('collection')
  if (!state.results.length) missing.push('≥1 rendu')
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
  $('#studioTranslateAll').addEventListener('click', translateAll)
  $('#recipeVerify').addEventListener('click', runServerVerify)
  $('#studioStepSave').addEventListener('click', saveStepEditor)
  $('#studioStepCancel').addEventListener('click', closeStepEditor)
  $('#studioTypeCancel').addEventListener('click', () => $('#studioTypeOverlay').classList.add('hidden'))
  refreshActionPersonalized()
}
