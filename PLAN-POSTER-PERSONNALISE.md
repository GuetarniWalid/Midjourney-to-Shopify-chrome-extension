# PLAN — Outil « Créer un poster personnalisé » (Publisher)

> **Statut : plan d'architecture VALIDÉ à implémenter tel quel.** Rédigé le 2026-07-03 par l'architecte
> (agent thème), à destination de l'agent de ce repo. Toute déviation d'architecture = à signaler avant de coder.
> Périmètre : ce repo (`extension-Midjourney/webapp`) **et** `MyselfMonArt_Backend` (pré-autorisé, cf. CLAUDE.md).
> Le repo THÈME (`tw_myselfmonart_shopify_theme`) n'est PAS à modifier — il est la **source de vérité** à lire.

---

## 0. Contexte métier (pourquoi cet outil)

La boutique a désormais un **studio de personnalisation générique** côté thème : un produit
« personnalisé » (ex. poster famille en dessin au trait) est entièrement piloté par **3 metafields**
posés sur la fiche produit Shopify — AUCUN déploiement de code n'est nécessaire pour créer un
nouveau produit personnalisé :

| Metafield | Type | Rôle | Qui le lit |
|---|---|---|---|
| `studio.config` | json | Les ÉTAPES du parcours client (photo, champs texte, format), libellés i18n 5 langues, juge photo (photoCheck/photoPolicy), exemples photo | Le THÈME (injecté en clair dans la page) |
| `studio.recipe` | json | La RECETTE de génération IA (prompt fragments, modèle, substitutions de textes, juge candidats) | Le BACK-END seulement (jamais côté client) |
| `studio.references` | list.file_reference | Image(s) de référence de style pour Gemini | Le BACK-END seulement |

Le 1er produit de ce type (« Poster famille personnalisé », gid `10565374247259`) a été monté À LA MAIN.
**Le but de l'outil : industrialiser cette création** — Walid part d'une image de design + une idée,
et l'outil produit une fiche produit complète, avec des JSON **garantis valides** (une virgule cassée
dans `studio.config` = studio mort en prod, sans message d'erreur ; c'est LE risque à éliminer).

**Sources de vérité à LIRE avant de coder (repo thème, chemins absolus) :**
- `C:\Users\gueta\Documents\Mes_projets\tw_myselfmonart_shopify_theme\dev-harness\validate-studio-config.mjs`
  — le validateur du contrat RÉEL du moteur (celui qu'on va embarquer, cf. §5).
- `C:\Users\gueta\Documents\Mes_projets\tw_myselfmonart_shopify_theme\growth\studio-configs\family.config.json`
  — la config de référence 5 langues (le PRESET n°1 de l'outil).
- `C:\Users\gueta\Documents\Mes_projets\tw_myselfmonart_shopify_theme\growth\studio-configs\family-lineart.recipe.json`
  — la recette de référence (PRESET recette n°1).
- `C:\Users\gueta\Documents\Mes_projets\tw_myselfmonart_shopify_theme\growth\STUDIO-GENERATION-RECIPE-CONTRACT.md`
  — contrat back-end de la recette (schéma §4, clamps, interpolation §5).
- `C:\Users\gueta\Documents\Mes_projets\tw_myselfmonart_shopify_theme\growth\STUDIO-PHOTO-CHECK-CONTRACT.md`
  — contrat du juge photo, §9 = photoPolicy (schéma exact).
- `C:\Users\gueta\Documents\Mes_projets\tw_myselfmonart_shopify_theme\growth\studio-configs\README.md`
  — pièges du moteur (types non implémentés, noms réservés, forme resolve/payloadKey).

---

## 1. Vue d'ensemble de l'architecture existante (ce qu'on étend)

- **Liste d'outils à la connexion** = `MyselfMonArt_Backend/resources/views/welcome.edge`
  (dashboard après login) : liens vers `/publisher`, `/publisher/reimage`, `/bulk-posters`…
- **Page Publisher** = UNE seule page servie par le back
  (`resources/views/pages/publisher.edge`), régénérée depuis `webapp/public/index.html` par
  `webapp/sync-prod.js` (copies byte-identiques de `app.js`/`style.css` + cache-busting `?v=<hash>`).
- **Modes** : la même page tourne en mode normal (`/publisher`) ou « reimage »
  (`/publisher/reimage` → `view.render('pages/publisher', { renderBase, mode: 'reimage' })`) ;
  `app.js` branche sur `IS_REIMAGE`. **C'est le pattern à réutiliser** pour le nouveau mode.
- **Moteur de rendu local** (`webapp/server.js`, port 4000, tunnel Cloudflare) : scan des PSD
  (`/api/templates`), rendu Photopea (`/api/render`), favoris (`/api/saved-templates`).
  Collections + publish ne passent PAS par lui : l'UI appelle le back directement (même origine).
- **Publication** : `POST /api/shopify-product-publisher/publish` (back), payload
  `{ images: [{base64Image|mediaId, type:'mockup'|'original', mockupContext, passePartout…}],
  ratio, productType, parentCollection:{id,title}, idempotencyKey }`.
  Le back fait TOUTE l'IA éditoriale (description HTML, tags, alt, title+SEO) via
  `App/Services/Claude/ProductPublisher`, puis crée le produit
  (`App/Services/ShopifyProductPublisher`). **⭐ Invariant précieux : l'œuvre (`type:'original'`)
  est TOUJOURS insérée en position 2 du tableau d'images** → elle finit en `media[1]` sur Shopify,
  ce qui est EXACTEMENT ce que le studio thème exige (texture de l'aperçu WebGL papier = `media[1]`).
- **Design system** (`webapp/public/style.css`) : clair neutre Radix Slate + 1 accent `#0090FF`,
  Inter, grille 8pt, cartes `.card`, segments `.seg`, combos `.combo`, overlays `.resize-overlay`
  + `.resize-card`, `.primary-btn`/`.ghost-btn`/`.accent-btn`, toast, actionbar fixe. **Aucun
  framework** : HTML statique + JS vanilla. Toute l'UI nouvelle DOIT être faite avec ces briques.

---

## 2. Ce qu'on construit (résumé exécutif)

1. **Nouvelle entrée du dashboard** (`welcome.edge`) : « Je veux **créer un poster personnalisé** »
   → route `/publisher/personalized`.
2. **Nouveau mode `personalized`** de la page Publisher (même page, même app.js — comme reimage) :
   - le flux mockups actuel INCHANGÉ (upload du design d'exemple → mockups Photopea → passe-partout) ;
   - type produit verrouillé sur **Poster** ;
   - **2 nouvelles cartes** : « Personnalisation (studio) » (builder de `studio.config`) et
     « Recette IA » (builder de `studio.recipe` + référence de style) ;
   - le bouton « Publier » reste le même, payload étendu d'un bloc `personalized`.
3. **Builder JSON « sûr à 100 % »** : presets → formulaires guidés (uniquement ce que le moteur
   implémente) → traduction auto FR→5 langues → validation LIVE avec le VRAI validateur du thème →
   aperçu du parcours client → publication bloquée tant que ce n'est pas vert.
4. **Back-end** : nouvel endpoint de validation + extension du pipeline de publication
   (variantes posters perso, templateSuffix, les ~10 metafields, upload de la référence dans Files,
   produit créé en **BROUILLON**).

---

## 3. Parcours utilisateur cible (UX, dans l'ordre de la page)

Mode `/publisher/personalized`. Cartes numérotées :

1. **« 1 · Votre design d'exemple »** = carte upload EXISTANTE, inchangée. L'image uploadée est le
   design de démonstration (ex. « La famille Martin — PAPA ♥ TOM ♥ MAMAN ♥ MIA ») : elle sert
   d'œuvre de galerie (`type:'original'`, donc `media[1]`/aperçu WebGL) ET de base aux mockups.
   Ratio attendu : portrait 3:4 (posters) — la mécanique ratio/retaillage existante s'applique.
2. **« 2 · Produit & collection »** = carte existante. Segment verrouillé sur Poster (les boutons
   Toile/Tapisserie sont masqués en mode personalized). Collection parente : combo existant
   (pré-suggérer « Poster Personnalisé Famille » gid `624856400219` par défaut, modifiable).
3. **« 3 · Personnalisation (studio) »** = **NOUVELLE carte**, le builder de `studio.config` (cf. §4).
4. **« 4 · Recette IA »** = **NOUVELLE carte**, le builder de `studio.recipe` + référence (cf. §6).
5. **« 5 · Mockups »** et **« 6 · Vos rendus »** = cartes existantes, renumérotées, inchangées.
6. **Barre d'action** : le bouton « Publier l'œuvre » devient « Publier le produit personnalisé »,
   `disabled` tant que (rendus ≥ 1) ET (config valide) ET (recette valide) ne sont pas tous vrais.
   Le libellé d'info (`#actionInfo`) affiche ce qui manque (« Config : 2 erreurs · Recette : OK »).

---

## 4. La carte « Personnalisation (studio) » — builder de `studio.config`

### 4.1 Principe : preset d'abord, jamais de page blanche

En tête de carte, un select « Partir de : » avec les **presets embarqués** (fichiers JSON copiés
depuis le repo thème dans `webapp/public/presets/`) :
- `famille-lineart` (COPIE de `family.config.json` du thème — 4 étapes photo → nom → prénoms →
  format, photoPolicy groupe/dos)
- `champs-texte` (COPIE adaptée de `prenom.json` du thème — texte → format, sans photo)
- `photo-simple` (à CRÉER : photo → format, le plus petit produit photo possible — dériver de
  famille-lineart en retirant les étapes texte et la policy groupe)

Choisir un preset REMPLIT tout le builder ; Walid ne fait ensuite que retoucher. Le champ
`productType` (slug technique, ex. `couple-aquarelle`) est TOUJOURS à saisir (unique par produit,
regex `^[a-z][a-z0-9-]*$`) — c'est la clé de routage back-end et de ségrégation des stats.

### 4.2 L'éditeur d'étapes

Liste verticale des étapes (cartes compactes réordonnables par les MÊMES interactions que les
rendus : appui long + glisser). Chaque étape affiche : icône type, `name`, titre FR, badge de
validité (✓ vert / ✗ rouge avec compteur d'erreurs). Boutons : éditer (ouvre l'overlay), dupliquer,
supprimer. Bouton « + Ajouter une étape » → choix du type.

**Types proposés à l'ajout — UNIQUEMENT ce que le moteur du thème rend réellement :**

| Type | Proposé ? | Pourquoi |
|---|---|---|
| `photo` | ✅ (max 1) | panneau dédié généralisé |
| `text` | ✅ | panneau générique |
| `number` | ✅ | panneau générique |
| `date` | ✅ (modes date/time seulement) | panneau générique (datetime rendu comme date → ne pas proposer) |
| `format` | ✅ (max 1, TOUJOURS en dernier, non supprimable) | obligatoire pour prix/variantes |
| `choice` | ⛔ MASQUÉ | rendu inline PAS implémenté (réservé foot/endpoint) |
| `group` | ⛔ MASQUÉ | enfants génériques PAS rendus (réservé maillot foot) |

L'UI ne permet donc PAS de construire une config que le moteur ne sait pas afficher — première
moitié du « sûr à 100 % ». (Le validateur §5 reste le filet pour le reste.)

**Règles imposées par l'UI (héritées du contrat moteur) :**
- `name` : regex `^[a-z][a-zA-Z0-9_]*$`, unicité, et REFUS des noms réservés `photo`/`team`/`name`/
  `format` pour un type non conforme (le validateur les bloque ; l'UI grise/prévient dès la saisie).
  Exception : l'étape photo s'appelle `photo`, l'étape format s'appelle `format` (conventions).
- étape `format` : générée automatiquement, non éditable sauf ses libellés — `roles` figés à
  `[{role:'size',payloadKey:'format',resolve:'dimensions'},{role:'frame',payloadKey:'frame',resolve:'slug'}]`
  (forme ACTUELLE du moteur ; la forme « riche » payloadValue/webglValue est refusée par le validateur).
- `text` : `transform` limité à `uppercase`/`none`, `charset` à `letters`/`free` (les autres valeurs
  sont des no-ops moteur → pas proposées).
- `payloadKey` : champ « clé back-end » avec défaut = name ; info-bulle expliquant son rôle.
- `cartProperty` : case à cocher « Afficher sur la ligne de commande » + libellé i18n (obligatoire
  si coché) — pour text/number/date.

### 4.3 L'overlay d'édition d'une étape

Pattern `resize-overlay`/`resize-card` existant. Contenu selon le type ; TOUS les libellés
utilisateur (title, checkpointLabel, label, placeholder, help, erreurs, captions…) sont des
**champs i18n** (cf. 4.4). Pour l'étape `photo`, l'overlay contient en plus :
- **Exemples bon/mauvais** : 2 slots d'upload d'image (bonne photo / photo à éviter) + alt i18n +
  caption i18n (mauvaise). Les images partent dans **Shopify Files** à la publication (le moteur
  thème accepte les URL complètes — champ `image` contenant `//`) ; l'UI stocke le base64 en attendant.
- **Juge photo (photoPolicy)** : interrupteur « Activer le contrôle photo » →
  `subject` (Une personne / Un groupe), `framing` (Visage / En pied), `people.min/max` (si groupe),
  grille `angles` = 4 lignes (face, trois-quarts, profil, dos) × 3 choix (🟢 parfait / 🟡 accepté /
  🔴 refusé), messages `warn_angle` + `reject_framing` (i18n). `faceAngle` (consigne photo) déduit :
  = l'angle marqué « parfait » (fallback `front`). ⚠️ Reproduire le schéma EXACT du contrat §9.2 —
  ne rien inventer.

### 4.4 i18n « hyper facilité » : FR + traduction auto

Chaque champ i18n de l'UI = UN champ FR visible + un bouton global par carte
**« Traduire tout (EN/DE/NL/ES) »** :
- POST back-end `POST /api/shopify-product-publisher/translate-batch`
  `{ items: [{ id, fr }] } → { items: [{ id, en, de, nl, es }] }` — **nouvel endpoint**. Le service
  de traduction existant est `App/Services/ChatGPT/Translator` (OpenAI + zodResponseFormat), mais il
  est structuré PAR RESSOURCE Shopify (constructeur `(payload, resource, targetLanguage)`) — pas
  d'API « batch de chaînes » réutilisable telle quelle : ajouter un handler léger dans ce service
  (ou un appel IA direct dédié), en gardant son modèle/config.
- Après traduction : chaque champ affiche un badge « 5 langues ✓ » ; un chevron déplie les 4 autres
  langues pour relecture/correction manuelle.
- **RÈGLE DURE : publication bloquée si une map i18n n'a pas les 5 langues** (leçon du produit
  famille : une config FR/EN seulement fait retomber DE/NL/ES sur le français).
- Les champs modifiés APRÈS traduction repassent en « FR seul » (badge orange) → retraduire.

### 4.5 Aperçu du parcours client

Sous l'éditeur, un panneau « Aperçu » statique (pas le vrai moteur — simple rendu HTML local) :
stepper avec les pastilles (checkpointLabel), et pour l'étape sélectionnée : titre + champ factice
(placeholder/label) + exemples photo. Onglets FR/EN/DE/NL/ES pour vérifier chaque langue d'un œil.
Objectif : Walid VOIT ce que verra le client sans publier. Rester simple (~150 lignes de JS max) —
c'est un aperçu de contrôle, pas une réplique du studio.

---

## 5. Validation « sûre à 100 % » — le VRAI validateur, à deux étages

### 5.1 Étage navigateur (feedback instantané)

**Copier `dev-harness/validate-studio-config.mjs` du repo thème** dans
`webapp/public/lib/validate-studio-config.js` en l'adaptant : la fonction `validateConfig(cfg)`
est du JS pur (aucune dépendance, corps l.49-233) — adaptation : retirer les imports node
(fs/url/path, l.20-25) et le bloc runner CLI (l.235-277), ajouter un `export`. **Diff NUL sur le
corps de `validateConfig`** (c'est lui qu'on re-synchronisera à chaque évolution du moteur).
En tête du fichier copié : commentaire « COPIE de <chemin thème> — resynchroniser à chaque évolution
du moteur studio ». Le builder l'exécute à CHAQUE modification ; erreurs affichées en rouge sur
l'étape concernée + résumé dans la carte. AJOUTER par-dessus (dans le builder, pas dans la copie) :
- exigence 5 langues sur toutes les maps i18n (le validateur thème n'exige que `fr`) ;
- présence obligatoire de `payload.extra.consent = "1"` si une étape photo existe (leçon du 422
  « consentement requis » du 1er test famille) ;
- `productType` non vide + unique (vérif d'unicité côté back, cf. 5.2).

### 5.2 Étage back-end (la porte finale)

**Nouvel endpoint** `POST /api/shopify-product-publisher/validate-personalized`
`{ studioConfig, studioRecipe } → { ok, errors: [{ where, message }] }` :
- re-exécute le MÊME validateur (copie serveur dans le back, même consigne de synchro) ;
- valide la recette avec les règles du contrat recette §4 + les clamps du worker, qui EXISTENT dans
  `App/Services/CustomArt/RecipeService.ts` et sont À RÉUTILISER (pas dupliquer) :
  `candidates` clampé [1,4] (l.26), `maxAttempts` [1,3] (l.27), `prompt.base` obligatoire (l.320),
  `inputs.title` configuré → `reference.texts.title` non-null (l.311-315), `inputs.tokens.max`
  clampé [1,8] (défaut 6, l.25-28) ;
- **règle NOUVELLE à écrire ici** (n'existe pas dans le worker) : cohérence
  `inputs.tokens.max = photoPolicy.people.max` quand les deux sont configurés (sinon le juge photo
  laisse passer plus de personnes que la recette ne peut nommer) ;
- vérifie que `productType` n'est pas déjà utilisé par un autre produit (lookup metafields).
L'UI appelle cet endpoint au clic « Publier » (et via un bouton « Vérifier ») ; toute erreur bloque.

---

## 6. La carte « Recette IA » — builder de `studio.recipe`

Preset : `family-lineart.recipe.json`. Champs (formulaire simple, PAS un éditeur JSON) :
- **Moteur** : `model` (défaut `gemini-3-pro-image` — ⚠️ les ID `-preview` sont morts), `aspect`
  (`3:4` défaut), `candidates` (1-4, défaut 3), `maxAttempts` (1-3, défaut 2).
- **Entrées** (`inputs`) : mapping AUTO depuis les étapes de la config (lecture seule enrichie) :
  chaque étape non-format apparaît avec sa payloadKey ; l'étape « prénoms » propose
  `tokens: {from, split:true, max:6}` ; le titre propose `template` (ex. « La famille {familyName} »).
- **Référence de style** : upload d'image (obligatoire) + `reference.texts.title` (le titre ÉCRIT
  sur l'image de référence, ex. « The Smith Family ») + `reference.texts.slots` (liste des
  textes-slots, ex. DADDY, FRANCO, MOMMY, VERONICA). Ces textes servent aux substitutions —
  info-bulle avec l'exemple famille. Case « le design d'exemple (carte 1) EST la référence » pour
  réutiliser la même image sans double upload (défaut : coché).
- **Prompt** : 3 zones de texte `prompt.base` (obligatoire) / `prompt.perPerson` / `prompt.footer`
  + les fragments spéciaux (`imageRoles`, `countLine`, `replaceTitle`, `addExtra`, `removeExtra`)
  repliés sous « Avancé » (pré-remplis par le preset ; en ANGLAIS — note UI : « Gemini suit mieux
  l'anglais »). Placeholders `{n}`, `{tokens}`, `{from}`, `{to}`, `{index}` documentés dans une
  légende (liste exacte = regex de `genericPrompt.ts:44` côté back).
- **Juge** : cases `judge.text` / `judge.figureCount` — défaut UI : cochées. (NB : le défaut
  BACK-END réel est `Boolean(tokens)` — RecipeService.ts:343-347 — donc écrire les valeurs
  explicitement dans la recette produite, ne pas compter sur le défaut.)
La validation recette (5.2) court aussi en live côté navigateur pour les règles simples
(base obligatoire, clamps, title↔reference.texts.title).

---

## 7. Publication — extension du pipeline back-end

### 7.1 Payload étendu (UI → back)

Le mode personalized ajoute au payload publish EXISTANT (images/ratio/parentCollection/
idempotencyKey — inchangés) :

```jsonc
"personalized": {
  "studioConfig": { …config complète validée… },      // SANS les exemples photo en base64
  "studioRecipe": { …recette complète validée… },
  "templateSuffix": "personalized-family",             // défaut ; champ « Avancé » de la carte 3
  "reference": { "base64Image": "data:…", "sameAsDesign": true },
  "photoExamples": { "good": { "base64Image": "data:…" }, "bad": { "base64Image": "data:…" } },
  "shortTitle": "Main dans la main"                    // H2 poétique ; champ manuel OU généré par l'IA du back
}
```

`productType` du payload racine reste `poster` (pour l'IA éditoriale) ; le slug perso vit dans
`studioConfig.productType`.

### 7.2 Ce que le back fait EN PLUS du pipeline publish actuel (ordre exact)

Étendre `ShopifyProductPublishersController.publishOnShopify` (branche `if (payload.personalized)`),
en déléguant à un nouveau service `App/Services/ShopifyProductPublisher/PersonalizedSetup.ts` :

1. **Pipeline actuel inchangé** : IA éditoriale (description/tags/alt/title+SEO) + création produit +
   upload des images (l'œuvre-design reste en position 2 → `media[1]` ✓). NB : le publish actuel
   pose DÉJÀ `link.mother_collection`, `title.short` (à la création, contrôleur l.161-180) et
   `artwork.type` (l.206) — ne pas les doubler.
2. **Variantes — ⚠️ ARCHITECTURE RÉELLE (vérifiée) : le publish ne crée AUCUNE variante.**
   La matrice taille×cadre des posters normaux est créée ASYNCHRONEMENT par le webhook
   `products/create` → `Modelcopier` (`WebhooksController.ts:143-207` →
   `artworkCopier.copyModelDataFromImageRatio`), qui CONVERGE options ET variantes vers le
   produit-modèle (tag `portrait model`) — suppressions comprises — et re-frappe à chaque update du
   modèle (`updateRelatedProductsFromModel`). Ses déclencheurs (`Modelcopier/Artwork.ts:262-270`) :
   pas un modèle + `artwork.type ∈ {painting, poster}` + `media[1]` présent → **un produit
   personnalisé les remplit** ; sans garde, le copieur ÉCRASERAIT la grille perso.
   Donc DEUX obligations :
   - **(P0, à shipper en premier — protège AUSSI le produit famille déjà live)** : ajouter une garde
     d'exclusion dans `canProcessProductCreate`/`getRelatedProducts` : **skip si
     `poster.isCustom = true`** (metafield). Sans elle, le prochain update du produit-modèle poster
     convergerait la fiche famille live vers la matrice standard (ajout 75x100/90x120…).
   - **PersonalizedSetup crée lui-même la grille perso** : options
     `Tailles: [30x40 cm, 60x80 cm]` × `Cadres: [Sans cadre, Cadre blanc, Cadre noir Mat, Cadre argent
     ancien, Cadre chêne clair, Cadre noyer]` (libellés/casse EXACTS — vérifiés live ; re-lire les
     NOMS d'options du produit famille au moment d'implémenter) ; prix : 30x40 = 24,90 / 47,90
     (encadré) ; 60x80 = 44,90 / 94,90. (Grille du produit famille live, 12 variantes.)
3. **templateSuffix** : `personalized-family` (du payload).
4. **Uploads Files** : référence de style (+ exemples photo bon/mauvais s'ils sont fournis en base64)
   → `fileCreate` (noms SEO : `studio-reference-<slug>.jpg`, `studio-photo-exemple-<slug>-bon.jpg`…) ;
   injecter les URL CDN obtenues dans `studioConfig.steps[photo].examples.*.image` AVANT d'écrire le
   metafield (le thème accepte les URL complètes).
5. **Metafields** (la liste COMPLÈTE ci-dessous fait 12 entrées ; 3 sont DÉJÀ posées par le pipeline
   actuel — `link.mother_collection`, `title.short`, `artwork.type` — il en reste **9 nouvelles**
   à écrire par PersonalizedSetup) :
   - `studio.config` (json) = studioConfig finalisé ;
   - `studio.recipe` (json) = studioRecipe ;
   - `studio.references` (list.file_reference) = [gid du fichier référence] ;
   - `title.short` (single_line_text_field) = shortTitle ;
   - `artwork.type` = `poster` ; `poster.isCustom` = `true` (⭐ ces 2 = règles de la collection
     smart famille → auto-ajout) ;
   - `painting_options.sizes` = `["gid://shopify/Metaobject/138179739995","gid://shopify/Metaobject/138451485019","gid://shopify/Metaobject/138451878235","gid://shopify/Metaobject/138452500827"]` ;
   - `painting_options.frames_canvas` = `["gid://shopify/Metaobject/139262263643","gid://shopify/Metaobject/138917380443","gid://shopify/Metaobject/138918297947","gid://shopify/Metaobject/138918527323","gid://shopify/Metaobject/138918855003","gid://shopify/Metaobject/138919182683"]`
     (set 100 % framePoster, « Sans cadre » PREMIER) ;
   - `painting_options.fixations` = `["gid://shopify/Metaobject/138270671195","gid://shopify/Metaobject/138271359323"]` ;
   - `link.mother_collection` (collection_reference) = la collection parente choisie ;
   - `mm-google-shopping.google_product_category` = `500044` ; `mc-facebook.google_product_category` = `500044`.
6. **Statut : BROUILLON (DRAFT), non publié sur les canaux.** Différence assumée avec le publish
   classique : un produit personnalisé doit être testé par Walid (parcours studio en Aperçu admin,
   1 génération réelle ≈ 0,55 €) avant d'être visible. La réponse renvoie l'URL admin du produit +
   un rappel « Tester le studio puis activer ». (Réutiliser le découplage création/publication déjà
   fait pour bulk-posters.)
7. **Idempotence** : même mécanique `IdempotencyStore` que le publish actuel (la clé couvre le
   payload personalized).

### 7.3 Sécurité/robustesse
- L'endpoint re-valide TOUT côté serveur (§5.2) même si l'UI a déjà validé (défense en profondeur).
- La recette ne redescend JAMAIS dans une réponse API (elle contient les prompts — secret métier).
- Échec au milieu (ex. metafield 4/10) : réponse d'erreur avec la LISTE de ce qui a été posé, et
  l'idempotencyKey permet de rejouer sans doublon (les setMetafield sont naturellement idempotents).

---

## 8. Intégration & fichiers touchés (checklist)

**Ce repo (`extension-Midjourney/webapp`) :**
- `public/index.html` : cartes 3-4 (builder + recette) + overlays d'édition + renumérotation.
  Tout en classes existantes (`card`, `field`, `combo`, `seg`, `resize-overlay`…).
- `public/app.js` : mode `IS_PERSONALIZED` (même mécanique que `IS_REIMAGE` : `window.PUBLISHER_CONFIG.mode`),
  builder (état, rendu, overlays, i18n, aperçu), branchement validation, extension du payload publish.
  Si le builder dépasse ~800 lignes, l'extraire dans `public/personalized.js` chargé par la page
  (ajouter aux copies de `sync-prod.js` + au `.edge` avec `?v=<hash>` comme `app.js`).
- `public/lib/validate-studio-config.js` : COPIE adaptée du validateur thème (cf. 5.1).
- `public/presets/*.json` : presets config + recette (copies depuis le thème, EN L'ÉTAT).
- `sync-prod.js` : ajouter les nouveaux fichiers aux copies + à la génération d'edge.
- `README.md` : section « poster personnalisé ».

**Repo back (`MyselfMonArt_Backend`) :**
- `start/routes.ts` : `GET /publisher/personalized` (render publisher.edge avec `mode: 'personalized'`,
  même middleware auth que `/publisher`) ; routes `POST …/validate-personalized` et
  `POST …/translate-batch` — ⚠️ protégées par `.middleware(['auth'])` **comme `/replace-images`**
  (routes.ts:120-123), PAS comme `/publish` qui est volontairement NON authentifié ; translate-batch
  déclenche des appels IA payants, l'auth est obligatoire (les fetch same-origin depuis /publisher
  envoient le cookie de session).
- `resources/views/welcome.edge` : nouvelle ligne « - Je veux **créer un poster personnalisé** »
  (copier la structure li/flèche existante), placée sous « publier un produit ».
- `resources/views/pages/publisher.edge` : régénéré par sync-prod (ne pas éditer à la main).
- `ShopifyProductPublishersController` + `App/Services/ShopifyProductPublisher/PersonalizedSetup.ts`
  + validateur serveur + endpoint traduction.

---

## 9. Ce qu'il ne faut PAS faire (garde-fous)

- ⛔ Ne PAS générer d'images par IA dans les tests (recette/génération = payant ; le back a des caps).
  Tester la publication avec un produit jetable puis le SUPPRIMER, ou pointer un `productType` de test.
- ⛔ Ne PAS éditer `publisher.edge` à la main (généré) ni toucher au flux publish NORMAL
  (non-personalized) — zéro régression sur l'outil quotidien.
- ⛔ Ne PAS inventer de champs de config/recette : tout champ vient des contrats du thème (§0).
  En cas de doute sur un champ → le chercher dans `validate-studio-config.mjs` ou les contrats ;
  s'il n'y est pas, il n'existe pas.
- ⛔ Ne PAS proposer choice/group/datetime dans l'UI (non implémentés côté moteur).
- ⛔ Pas de framework front, pas de CSS hors des tokens existants, cibles tactiles ≥ 44px (mobile-first).
- ⚠️ Encodage : contenus accentés → fichiers écrits en UTF-8 via l'éditeur, JAMAIS via heredoc shell.

## 10. Phasage & critères d'acceptation

- **P1 — Socle** : route + entrée dashboard + mode personalized (cartes visibles, segment verrouillé
  poster, presets chargés, publish encore désactivé). ✅ = la page s'affiche en local ET en prod.
- **P2 — Builder config** : éditeur d'étapes + overlays + i18n/traduction + validateur navigateur +
  aperçu. ✅ = partir du preset famille, renommer 2 champs, traduire, 0 erreur ; introduire
  volontairement un `name` réservé → erreur affichée.
- **P3 — Recette + validation back** : carte recette + `validate-personalized` + `translate-batch`.
  ✅ = la recette famille passe ; une recette sans `prompt.base` est bloquée aux DEUX étages.
- **P4 — Publication** : `PersonalizedSetup` + payload étendu. ✅ = publier un produit de TEST
  (collection test), vérifier dans l'admin : brouillon, 12 variantes aux bons prix, templateSuffix,
  les 10 metafields, référence dans Files, `media[1]` = design ; ouvrir l'Aperçu admin → le studio
  affiche les étapes du builder en FR et DE. Puis SUPPRIMER le produit de test.
- **P5 — Polish** : messages d'erreur, i18n badges, doc README, sync-prod, déploiement.

Chaque phase : typecheck + commit + push (autonomie CLAUDE.md), et une vérification NAVIGATEUR
réelle (l'UI est le produit).
