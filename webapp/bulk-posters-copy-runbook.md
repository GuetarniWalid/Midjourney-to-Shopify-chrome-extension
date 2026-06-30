# Runbook — « Posters en masse » (mode COPIE, piloté par agent, sans navigateur)

Procédure que **toi, agent Claude Code**, exécutes pour créer des posters à partir des toiles Shopify.
Le mécanique (copie des metafields, rendu, variantes, publication, robustesse) est **déterministe**
côté serveur. **Ton SEUL rôle non-déterministe : rédiger le texte du poster** (titre H1, description
HTML, SEO) en transposant la toile validée vers le poster. Tu ne copies / ne rends / ne publies rien
toi-même : tu lis, tu rédiges, tu déclenches.

L'agent appelle **uniquement le moteur de rendu** (PC, `http://localhost:4000`). Celui-ci détient le
jeton de service et parle au backend. Pour lire le texte source des toiles, utilise le **MCP Shopify**.

---

## 0. Pré-requis (le owner les vérifie AVANT de te lancer)
- Moteur de rendu PC démarré (`node server.js`, port 4000) **avec `sharp` installé** (`npm install`
  dans `webapp/` après le pivot) et **redémarré**.
- Favoris ★ poster **Photopea** configurés dans le studio pour l'orientation lancée (portrait ET/OU
  paysage). Le mode COPIE n'utilise **aucun décor IA** (zéro Gemini) : seuls les favoris Photopea.
- (Aucun secret/token à configurer : les endpoints `/api/bulk-posters/*` ne sont pas authentifiés,
  comme le bouton « publier ». `BACKEND_BASE` n'est à poser dans `webapp/.env` que si le backend
  n'est pas la prod `https://www.myselfmonart.com`.)

## 1. Paramètres du run (donnés par le owner)
- `ratio` : `portrait` ou `landscape` (un seul à la fois).
- `count` : nombre de toiles à traiter (test : **2 ou 3** d'abord ; puis montée en charge).
- **Cap quotidien** : ne crée jamais plus de ~**140** posters/jour (1000 variantes ÷ 7, marge gardée).
  En pratique, tu **t'arrêtes au premier statut `cap`** renvoyé (voir §4).

## 2. Récupérer les toiles candidates
`GET http://localhost:4000/api/bulk-posters/candidates?ratio=<ratio>`
→ `{ success, data: { ratio, total, pending, candidates, skipped } }`
- `candidates[]` : `{ toileId, title, artworkUrl, collectionId, collectionTitle }` — les toiles à créer.
- `pending[]` : `{ toileId, posterId, title }` — brouillons d'un run précédent à **finaliser d'abord**.
- `skipped[]` : toiles sans collection poster mappée (ignorées, normal). Logue le nombre.

## 3. Finaliser les brouillons en attente (reprise, AUCUN re-rendu) — avant de créer
Pour chaque `p` de `pending` :
`POST http://localhost:4000/api/bulk-posters/finalize-pending` body `{ toileId: p.toileId, posterId: p.posterId, ratio }`
→ `{ status }` : `published` (ok) · `cap` (toujours pas complet, normal) · `missing` (brouillon
disparu, toile rouverte) · `error`. Compte les `published`.

## 4. Pour chaque toile candidate (dans la limite de `count` ET du cap)
1. **Lis le texte source de la toile** via le **MCP Shopify** (`getProduct` sur `toileId`) : récupère
   `title`, `descriptionHtml`, et le SEO (`seo.title`, `seo.description`). C'est ta matière première.
2. **Rédige le texte du POSTER** (voir §5) : `title` (H1), `descriptionHtml`, `seoTitle`, `seoDescription`.
3. **Déclenche la création** (rendu + copie + publication, tout-ou-rien) — **1 seul appel** :
   `POST http://localhost:4000/api/bulk-posters/run-one` body :
   ```json
   {
     "toileId": "<candidates[i].toileId>",
     "artworkUrl": "<candidates[i].artworkUrl>",
     "ratio": "<ratio>",
     "collectionId": "<candidates[i].collectionId>",
     "collectionTitle": "<candidates[i].collectionTitle>",
     "title": "<H1 que tu as rédigé>",
     "descriptionHtml": "<description HTML que tu as rédigée>",
     "seoTitle": "<metaTitle>",
     "seoDescription": "<metaDescription>"
   }
   ```
   ⚠️ Cet appel est **long** : plusieurs rendus Photopea **sérialisés** (≈ N favoris × 2, mockups +
   jumeaux) + attente des variantes (jusqu'à 120 s). Compte ~3–5 min, davantage si beaucoup de favoris.
   Utilise un **timeout client large** (ex. `curl --max-time 900`) ; le serveur, lui, ne coupe jamais
   cette requête. Si malgré tout le client coupe (hang-up), **ne recrée pas à l'aveugle** : relance plus
   tard `candidates` — la toile reviendra en `pending` (brouillon gardé) et `finalize-pending` la finira.
   → `{ status, colorThemeFromAI? }` :
   - `published` : poster en ligne, lié à la toile. ✅ compte-le, continue.
   - `cap` : variantes non créées dans le délai → **cap quotidien probable**, le brouillon est gardé
     (caché) et sera fini au prochain run. **ARRÊTE-TOI immédiatement** (créer plus ne ferait que des
     brouillons incomplets). Rapporte.
   - `kept` : la création a réussi mais la **finalisation** a hoqueté (le produit est peut-être déjà en
     ligne) ; le brouillon est **conservé** (jamais supprimé). Logue `note`, **CONTINUE** : il sera
     repris au prochain run via `pending`/`finalize-pending`.
   - `failed` : le brouillon raté a été supprimé (tout-ou-rien). Logue `error`, **continue** la toile suivante.
   - `colorThemeFromAI: true` (sur n'importe quel statut) : la toile n'avait pas ses couleurs/thèmes →
     le webhook les détecte par IA (1 appel). **Note-le dans le rapport** (ce n'est pas « zéro IA »).

## 5. RÈGLES DE RÉDACTION DU TEXTE POSTER (le seul travail créatif)
**Méthode** : pars du texte EXISTANT de la toile (titre/description/SEO, déjà validés) et **ré-écris-le
pour le poster** — même sujet, même émotion, même référence iconique éventuelle — mais vocabulaire
poster et **reformulé assez pour NE PAS être un doublon** de la toile (anti-cannibalisation de contenu).
Tu **transposes** une toile en poster, tu n'inventes pas une nouvelle œuvre.

### 5.1 `title` (H1, 6–12 mots)
Format : **`[Ouverture] [Sujet/Référence iconique] - [Descripteur évocateur]`**
- Ouvertures AUTORISÉES (poster) : « Poster & affiche », « Poster », « Poster mural »,
  « Affiche moderne », « Affiche murale ». **JAMAIS** « Tableau / Toile / Cadre / Art mural / Œuvre ».
- La **référence iconique** de la toile (personnage, lieu, marque, œuvre, style reconnaissable), si
  présente, **DOIT** réapparaître, juste après l'ouverture, **à l'identique**.
- Le **descripteur** (après le tiret) est ce qui différencie. Tu peux garder l'esprit de celui de la
  toile mais reformule-le (synonymes, angle légèrement autre) pour éviter le doublon mot-pour-mot.
- Lisible à voix haute, on visualise l'œuvre. Pas de bourrage de mots-clés, pas de « Magnifique… ».

### 5.2 `seoTitle` (metaTitle, **≤ 60 caractères**)
- Commence **OBLIGATOIREMENT** par « **Poster** » (le mot court, pas « Poster & affiche »).
- Finit **TOUJOURS** par « **&nbsp;| MyselfMonArt** » (séparateur **pipe**, pas tiret) — ~16 chars.
- Structure : `Poster [Sujet/Référence] - [Descripteur très court] | MyselfMonArt`.
- Si référence iconique : juste après « Poster ». Variation concise du H1, pas une copie.

### 5.3 `seoDescription` (metaDescription, **140–155 caractères**)
- Structure : `[ce qu'on voit] + [l'ambiance/effet] + [bénéfice client]`.
- Contient naturellement « **affiche** » (ou « poster »). Mentionne la référence iconique si présente.
- Engageant, jamais racoleur. Pas de « Livraison rapide / Satisfaction garantie ».

### 5.4 `descriptionHtml` (corps de la fiche)
Garde le **ton et la qualité** des descriptions toile, mais **bascule le vocabulaire en poster** :
- **Ton** : sensoriel, chaleureux, vouvoiement, ancré dans le concret. **ZÉRO jargon** (« chromatique »,
  « palette », « point focal », « composition »…). Pas de formules creuses (« transforme l'espace »…).
- **Structure narrative** (4 temps) : accroche émotionnelle (parle du ressenti/la vie, **pas** du
  produit) → description sensorielle de l'œuvre (couleurs/scène par ce qu'elles font ressentir) →
  projection dans la pièce (≥ 2 emplacements concrets) → ancrage final qui résonne.
- Si **référence iconique** : nommée dans les 3 premières phrases, comme sur la toile.
- **HTML** : uniquement des balises `<p>`. **Aucun** titre (`<h1/2/3>`), **aucune** liste. Guillemets
  français « … ». Longueur ~150–200 mots.
- **Vocabulaire POSTER, jamais toile/tableau/châssis** :
  - dis « ce poster », « cette affiche », « cette impression » — **jamais** « cette toile / ce tableau ».
  - **angle médium poster** (ce qui le distingue de la toile) : impression sur **papier** (qualité
    d'impression), **léger**, **à encadrer selon vos envies** (le cadre n'est **pas** inclus), **format
    abordable**. N'évoque pas le châssis, la texture toile, le côté « premium toile ».
- **Anti-cannibalisation** : même sujet/émotion que la toile, mais **reformule** (ne recopie pas les
  phrases). La différence de médium (affiche papier à encadrer vs toile sur châssis) doit transparaître.

### 5.5 Exemple de transposition
- Toile (existant) → H1 « Tableau sur toile Le Petit Prince - Poésie étoilée et renard ».
- Poster (à rédiger) → H1 « **Poster Le Petit Prince - Douceur étoilée et renard fidèle** »,
  `seoTitle` « **Poster Le Petit Prince - Poésie étoilée | MyselfMonArt** », `seoDescription` ~150 car.
  contenant « affiche », et une description qui parle d'une **affiche à encadrer**, papier, légère.

## 6. Rapport final
Récapitule : `publiés`, `repris (pending→publiés)`, `kept` (finalisation à reprendre, nb), `cap`
(oui/non + nb de brouillons gardés), `échecs` (avec le message de chaque), et le nb de toiles
`colorThemeFromAI` (couleurs/thèmes détectés par IA faute de valeurs sur la toile). Si `cap` atteint :
« relancer demain (même ratio) pour finir les brouillons gardés ». Les `kept` se finissent aussi au
prochain run (via `pending`). Les `failed` sont à corriger puis relancer (re-appeler `candidates` les
re-listera : leur marqueur `poster_draft` a été nettoyé par le `delete-draft`).

## Notes
- Le tout-ou-rien, les 2 tentatives, la suppression sur échec, la reprise et le cap sont **gérés par
  les endpoints** (déterministe). Tu ne réimplémentes rien de cela.
- Aucune image n'est générée par IA (favoris **Photopea** uniquement). Aucun texte n'est généré par
  l'API payante : c'est **toi** (agent) qui rédiges, gratuitement.
- Ne traite **qu'un ratio à la fois**. Pour le paysage, le owner doit d'abord avoir des favoris ★
  poster Photopea en paysage.
