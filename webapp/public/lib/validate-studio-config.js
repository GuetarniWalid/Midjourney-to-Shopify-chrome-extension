/* ============================================================================
 * COPIE de tw_myselfmonart_shopify_theme/dev-harness/validate-studio-config.mjs
 * — RESYNCHRONISER à chaque évolution du moteur studio (assets/component-custom-art-studio.js).
 *
 * Adaptation pour le navigateur (script classique, pas de module ESM) :
 *   - retirés : les imports node (fs/url/path) et le bloc runner CLI en fin de fichier ;
 *   - ajouté  : window.StudioValidator = { validateConfig } tout en bas.
 * Le CORPS de validateConfig (et ses helpers checkStep/checkI18n + les const) est IDENTIQUE
 * au thème — DIFF NUL exigé (c'est lui qu'on re-synchronise). Ne rien modifier ici : les
 * règles supplémentaires du builder (5 langues, consent, productType) vivent dans
 * personalized.js, PAS dans cette copie.
 * ==========================================================================*/

const STEP_TYPES = ['photo', 'choice', 'text', 'number', 'date', 'format', 'group'];
const RESOLVE_VALUES = ['slug', 'dimensions'];
// Le moteur ne traite spécialement que role==='frame' (regex option finition) ; tout autre rôle
// lit l'option FORMAT. Ces synonymes = rôles « format » connus (pas d'avertissement).
const FORMAT_ROLE_SYNONYMS = ['size', 'format', 'taille', 'dimension'];
// Enfants de group réellement rendus par le moteur (panneau maillot foot dédié) ; tout autre
// enfant générique ne s'afficherait pas (renderGenericPanels ne parcourt pas les enfants de group).
const FOOT_GROUP_CHILDREN = ['playerName', 'playerNumber'];
const TRANSFORMS = ['uppercase', 'lowercase', 'none'];
const TRANSFORMS_IMPL = ['uppercase', 'none'];   // lowercase = no-op moteur
const CHARSETS = ['letters', 'alphanum', 'free'];
const CHARSETS_IMPL = ['letters', 'free'];       // alphanum = no-op moteur (free = défaut sans filtre)
const DATE_MODES = ['date', 'time', 'datetime'];
const DATE_MODES_IMPL = ['date', 'time'];        // datetime rendu comme "date" par le moteur
const SUPPORTED_VERSION = 1;
const NAME_RE = /^[a-z][a-zA-Z0-9_]*$/;
// Panneaux dédiés codés en dur dans la section foot (sections/tw-custom-art-studio.liquid) :
// data-studio-panel="photo|team|name|format". Le moteur RÉUTILISE tout panneau existant avec ce
// name -> un step de 1er niveau qui porte un de ces noms AVEC un type différent détourne le
// panneau foot (ex : "name" type text -> écran maillot prénom+numéro). Type attendu par panneau :
const RESERVED_PANELS = { photo: 'photo', team: 'choice', name: 'group', format: 'format' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

// Une map i18n = objet { fr, en, … } -> doit au moins avoir une clé `fr` (résolution moteur: map[locale]||map.fr||'').
function checkI18n(value, path, ctx, { required }) {
  if (value == null) {
    if (required) ctx.warn(`${path} : libellé absent (recommandé : map i18n { "fr": "…" }).`);
    return;
  }
  if (typeof value === 'string') {
    ctx.warn(`${path} : chaîne simple « ${value} » — préférer une map i18n { "fr": "…", "en": "…" } pour le multilingue.`);
    return;
  }
  if (!isObject(value)) { ctx.err(`${path} : doit être une map i18n { "fr": "…" } (reçu ${typeof value}).`); return; }
  if (typeof value.fr !== 'string' || !value.fr.trim()) ctx.err(`${path} : la clé "fr" est obligatoire (repli du moteur).`);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') ctx.err(`${path}.${k} : doit être une chaîne.`);
  }
}

function checkStep(step, ctx, { isChild = false } = {}) {
  const where = step && step.name ? `step "${step.name}"` : 'step (sans name)';
  if (!isObject(step)) { ctx.err(`${where} : doit être un objet.`); return; }

  // name
  if (typeof step.name !== 'string' || !step.name) ctx.err(`${where} : "name" obligatoire (string).`);
  else {
    if (!NAME_RE.test(step.name)) ctx.err(`step "${step.name}" : "name" doit matcher ^[a-z][a-zA-Z0-9_]*$.`);
    if (ctx.names.has(step.name)) ctx.err(`step "${step.name}" : "name" en double (doit être unique, enfants compris).`);
    ctx.names.add(step.name);
  }

  // type
  if (!STEP_TYPES.includes(step.type)) { ctx.err(`${where} : "type" invalide « ${step.type} » (attendu : ${STEP_TYPES.join('|')}).`); return; }

  // Collision de nom réservé : un step de 1er niveau nommé photo/team/name/format réutilise le
  // panneau dédié foot. Si le type ne correspond pas, il détourne ce panneau (bug silencieux).
  if (!isChild && step.name in RESERVED_PANELS && step.type !== RESERVED_PANELS[step.name]) {
    ctx.err(`step "${step.name}" : ce nom est réservé au panneau foot "${step.name}" (type ${RESERVED_PANELS[step.name]}). `
      + `Avec type "${step.type}" il détournerait ce panneau. Renomme le step (ex : "${step.name}Field") et garde "payloadKey": "${step.payloadKey || step.name}" pour le back-end.`);
  }

  if ('required' in step && typeof step.required !== 'boolean') ctx.err(`${where} : "required" doit être un booléen.`);
  if ('payloadKey' in step && typeof step.payloadKey !== 'string') ctx.err(`${where} : "payloadKey" doit être une chaîne.`);

  // title : lu par showStep (titre d'en-tête). Recommandé pour les steps de 1er niveau.
  checkI18n(step.title, `${where}.title`, ctx, { required: !isChild });
  if ('checkpointLabel' in step) checkI18n(step.checkpointLabel, `${where}.checkpointLabel`, ctx, { required: false });

  switch (step.type) {
    case 'photo': {
      if ('consent' in step && step.consent != null) {
        if (!isObject(step.consent)) ctx.err(`${where}.consent : doit être un objet { "required": true }.`);
        else if ('required' in step.consent && typeof step.consent.required !== 'boolean') ctx.err(`${where}.consent.required : booléen attendu.`);
      }
      break;
    }
    case 'choice': {
      const source = step.source || (Array.isArray(step.options) ? 'inline' : undefined);
      if (source && !['inline', 'endpoint'].includes(source)) ctx.err(`${where}.source : "inline" ou "endpoint".`);
      if (source === 'endpoint' && typeof step.endpoint !== 'string') ctx.err(`${where} : source "endpoint" requiert "endpoint" (string).`);
      if (source === 'inline') {
        if (!Array.isArray(step.options) || !step.options.length) ctx.err(`${where} : source "inline" requiert "options" (>=1).`);
        else step.options.forEach((opt, i) => {
          if (!isObject(opt)) { ctx.err(`${where}.options[${i}] : objet attendu.`); return; }
          if (typeof opt.id !== 'string' || !opt.id) ctx.err(`${where}.options[${i}] : "id" obligatoire.`);
          if (opt.label == null) ctx.err(`${where}.options[${i}] : "label" obligatoire.`);
          else checkI18n(typeof opt.label === 'string' ? { fr: opt.label } : opt.label, `${where}.options[${i}].label`, ctx, { required: true });
        });
        ctx.warn(`${where} : le moteur ACTUEL ne rend les "choice" que pour le foot (source endpoint + fixture). Une "choice" inline ne s'affichera pas tant que le rendu choice générique n'est pas codé (refactor moteur).`);
      }
      break;
    }
    case 'text': {
      if ('minLength' in step && !(isInt(step.minLength) && step.minLength >= 0)) ctx.err(`${where}.minLength : entier >=0.`);
      if ('maxLength' in step && !(isInt(step.maxLength) && step.maxLength >= 1)) ctx.err(`${where}.maxLength : entier >=1.`);
      if ('transform' in step && !TRANSFORMS.includes(step.transform)) ctx.err(`${where}.transform : ${TRANSFORMS.join('|')}.`);
      else if ('transform' in step && !TRANSFORMS_IMPL.includes(step.transform)) ctx.warn(`${where}.transform "${step.transform}" : non implémenté par le moteur actuel (no-op ; seul "uppercase" agit).`);
      if ('charset' in step && !CHARSETS.includes(step.charset)) ctx.err(`${where}.charset : ${CHARSETS.join('|')}.`);
      else if ('charset' in step && !CHARSETS_IMPL.includes(step.charset)) ctx.warn(`${where}.charset "${step.charset}" : non implémenté (no-op ; seul "letters" filtre les caractères).`);
      if (!isChild && step.label == null) ctx.warn(`${where} : "label" recommandé (le panneau générique affiche label||title).`);
      break;
    }
    case 'number': {
      if ('min' in step && !isInt(step.min)) ctx.err(`${where}.min : entier attendu.`);
      if ('max' in step && !isInt(step.max)) ctx.err(`${where}.max : entier attendu.`);
      if ('min' in step && 'max' in step && isInt(step.min) && isInt(step.max) && step.min > step.max) ctx.err(`${where} : min > max.`);
      if ('integer' in step && typeof step.integer !== 'boolean') ctx.err(`${where}.integer : booléen.`);
      else if (step.integer === false) ctx.warn(`${where} : "integer": false n'est pas honoré — le moteur impose toujours des entiers (parseInt + filtrage des non-chiffres).`);
      if (!isChild && step.label == null) ctx.warn(`${where} : "label" recommandé (panneau générique).`);
      break;
    }
    case 'date': {
      if ('mode' in step && !DATE_MODES.includes(step.mode)) ctx.err(`${where}.mode : ${DATE_MODES.join('|')}.`);
      else if ('mode' in step && !DATE_MODES_IMPL.includes(step.mode)) ctx.warn(`${where}.mode "${step.mode}" : rendu comme "date" par le moteur actuel (seul "time" est distinct).`);
      if ('min' in step || 'max' in step) ctx.warn(`${where} : "min"/"max" sur une date ne sont pas appliqués côté client (le moteur n'émet pas d'attribut min/max pour les dates ; le back-end revalide).`);
      if (!isChild && step.label == null) ctx.warn(`${where} : "label" recommandé (panneau générique).`);
      break;
    }
    case 'format': {
      if (!Array.isArray(step.roles) || !step.roles.length) { ctx.err(`${where} : "roles" (>=1) obligatoire.`); break; }
      step.roles.forEach((role, i) => {
        const rw = `${where}.roles[${i}]`;
        if (!isObject(role)) { ctx.err(`${rw} : objet attendu.`); return; }
        if (typeof role.role !== 'string' || !role.role) ctx.err(`${rw}.role : chaîne non vide obligatoire.`);
        else if (role.role !== 'frame' && !FORMAT_ROLE_SYNONYMS.includes(role.role)) ctx.warn(`${rw}.role « ${role.role} » : le moteur ne distingue que role==="frame" (option finition) ; tout autre rôle lit l'option FORMAT. Un "border"/"other" lirait l'option format, pas une bordure -> vérifie que c'est voulu.`);
        // LE point critique : buildPayload lit role.resolve (slug|dimensions). La forme du plan §4
        // (payloadValue/webglValue) n'est PAS encore lue -> on la refuse explicitement.
        if (!('resolve' in role) && ('payloadValue' in role || 'webglValue' in role)) {
          ctx.err(`${rw} : utilise "payloadValue"/"webglValue" (schéma futur §4, NON implémenté) mais pas "resolve". `
            + `Le moteur actuel lit role.resolve -> remplace par "resolve": "${role.role === 'frame' ? 'slug' : 'dimensions'}" sinon le payload casse.`);
        } else if (!RESOLVE_VALUES.includes(role.resolve)) {
          ctx.err(`${rw}.resolve : "slug" ou "dimensions" obligatoire (lu par buildPayload).`);
        }
        if (typeof role.payloadKey !== 'string' || !role.payloadKey) {
          ctx.warn(`${rw} : "payloadKey" absent -> la clé back-end retombe sur le nom de rôle « ${role.role} ». `
            + `Pour le foot il FAUT "format"/"frame" (pas "size"). Précise payloadKey.`);
        }
      });
      break;
    }
    case 'group': {
      if (isChild) ctx.err(`${where} : un "group" ne peut pas être imbriqué dans un "group".`);
      if (!Array.isArray(step.children) || !step.children.length) { ctx.err(`${where} : "children" (>=1) obligatoire.`); break; }
      step.children.forEach((child) => {
        checkStep(child, ctx, { isChild: true });
        // TROP LAX sinon : le moteur ne rend un panneau d'input QUE pour le group maillot foot
        // (playerName/playerNumber). Un autre enfant générique ne s'afficherait pas -> blocage.
        if (isObject(child) && ['text', 'number', 'date'].includes(child.type) && !FOOT_GROUP_CHILDREN.includes(child.name)) {
          ctx.warn(`${where}.children "${child && child.name}" : le moteur actuel ne rend un panneau d'input QUE pour le group maillot foot (playerName/playerNumber). `
            + `Un enfant "${child.type}" ne s'affichera pas (renderGenericPanels ne parcourt pas les enfants de group) -> l'étape resterait bloquée. Réservé au refactor moteur.`);
        }
      });
      break;
    }
    default:
      break;
  }
}

function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  const ctx = {
    names: new Set(),
    err: (m) => errors.push(m),
    warn: (m) => warnings.push(m),
  };

  if (!isObject(cfg)) { errors.push('Racine : doit être un objet JSON.'); return { errors, warnings }; }

  if (!isInt(cfg.version)) errors.push('version : entier obligatoire.');
  else if (cfg.version !== SUPPORTED_VERSION) warnings.push(`version ${cfg.version} : le moteur supporte la version ${SUPPORTED_VERSION}.`);

  if ('productType' in cfg && typeof cfg.productType !== 'string') errors.push('productType : chaîne attendue.');

  if (!Array.isArray(cfg.steps) || !cfg.steps.length) errors.push('steps : tableau non vide obligatoire (>=1).');
  else cfg.steps.forEach((step) => checkStep(step, ctx));

  if ('payload' in cfg && cfg.payload != null) {
    if (!isObject(cfg.payload)) errors.push('payload : objet attendu.');
    else if ('extra' in cfg.payload && cfg.payload.extra != null) {
      if (!isObject(cfg.payload.extra)) errors.push('payload.extra : objet { clé: "valeur" } attendu.');
      else for (const [k, v] of Object.entries(cfg.payload.extra)) {
        if (typeof v !== 'string') warnings.push(`payload.extra.${k} : valeur non-string (${typeof v}) -> sera convertie en chaîne dans le FormData.`);
      }
    }
  }

  // Mode SANS génération (produit design fixe : generation.enabled === false). Le moteur saute
  // photo/attente/reveal et ajoute au panier directement, avec les champs cartProperty en propriétés
  // de commande. (Même condition que le moteur : hasGeneration = !(generation && enabled === false).)
  const noGen = !!(cfg.generation && cfg.generation.enabled === false);
  if (noGen && Array.isArray(cfg.steps)) {
    if (cfg.steps.some((s) => s && s.type === 'photo')) {
      warnings.push('generation.enabled:false (sans génération) mais une étape "photo" existe : sans back-end, la photo n\'est ni envoyée ni traitée. Retire l\'étape photo.');
    }
    const hasCartProp = (steps) => (steps || []).some((s) => s && (s.cartProperty || (s.type === 'group' && hasCartProp(s.children))));
    if (!hasCartProp(cfg.steps)) {
      warnings.push('mode sans génération mais aucune étape n\'a "cartProperty" : la commande ne portera ni prénom ni numéro. Ajoute "cartProperty" (ex : { "label": { "fr": "Prénom" } }) aux champs à imprimer.');
    }
  }

  return { errors, warnings };
}

// --- Exposition navigateur (script classique) : scope global partagé avec personalized.js ---
window.StudioValidator = { validateConfig };
