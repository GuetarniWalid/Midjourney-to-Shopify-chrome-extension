# PLAN — Unifier le studio CustomArt sur UN seul moteur (migrer le foot, supprimer le legacy)

> **Statut : plan chiffré et vérifié, à valider avant implémentation.** Produit par orchestration multi-agents le 2026-07-21,
> **révisé le 2026-07-22** pour adopter le modèle « tout-en-références, par nom » (décision propriétaire : zéro backend au quotidien).
> Périmètre : `MyselfMonArt_Backend` (moteur + aval) **et** `tw_myselfmonart_shopify_theme` (front studio).
> Objectif : **une seule façon de faire** — le foot devient un profil de recette, plus un chemin de code. **Tout se paramètre depuis la fiche produit Shopify ; on ne touche plus au backend pour créer/modifier un produit personnalisé.**

---

## ✅ P7 FAIT — recette foot construite, prompt PROUVÉ identique, 30 maillots migrés

**Accès serveur** : le domaine passe par Cloudflare (port 22 filtré), mais l'origine
`64.226.101.205` est joignable en SSH. Les commandes d'export et de migration ont donc pu être
lancées directement dans le conteneur applicatif.

1. **Recette foot construite depuis les données réelles** — 15 équipes, 30 maillots, consignes de
   fidélité. Versionnée en fixture (`tests/golden/fixtures/foot-recipe.draft.json`).
2. **🎯 Le prompt produit est IDENTIQUE au legacy, caractère pour caractère** — vérifié sur
   **60 combinaisons** (15 équipes × 4 saisies), dont les cas-pièges : le « I » sans point (piège
   turc explicitement cité dans le prompt maître), un prénom accentué, les bornes 1 et 99. Le test
   est **permanent et tourne en CI**. C'est la moitié déterministe de la parité : ce qu'on demande
   au générateur ne change pas.
3. **30 maillots migrés** vers Shopify Files, sans anomalie ni renommage. La recette est reconstruite
   à partir des noms **relus après téléversement**, pas supposés.

**Deux ajustements découverts à l'usage** (pas en théorie) : le corps du prompt a son propre plafond
de longueur (un prompt maître calibré fait ~2 500 caractères, la borne des fragments courts était de
2 000) ; et les annonces d'images sont exposées sous `{images}`, comme les consignes sous `{notes}`,
pour qu'un prompt calibré les place **où il les attend** plutôt que de subir l'ordre de l'assembleur.

**Écritures faites** : uniquement additives (nouveaux fichiers dans la médiathèque). **Aucun produit,
aucun metafield, aucune commande touchés** — le poster foot tourne toujours sur son chemin d'origine.

### ✅ Le pont client est posé — l'écran envoie désormais le SLUG

L'incompatibilité décrite ci-dessous est **levée** (thème `9ffcb2f`, déployé et vérifié en ligne :
`teamSlug` est présent dans l'asset servi aux clients).

L'écran envoie maintenant **`teamSlug` en plus de `teamId`**. Le chemin historique lit `teamId` et
ignore le reste ; le chemin piloté par recette lit `teamSlug`. Rien n'est retiré — les deux restent
fonctionnels pendant toute la transition. Le slug est aussi mémorisé dans l'état local, pour survivre
à une reprise de commande.

**Canal de déploiement du thème — tranché** : le dépôt thème a son propre workflow GitHub
(`deploy-shopify-theme.yml`) qui **déploie automatiquement sur push**. C'était une des trois décisions
en attente ; elle est répondue par l'observation, pas par supposition.

**P5 se décompose donc en deux niveaux**, et seul le premier était nécessaire ici :
1. ✅ **Le parcours client fonctionne** avec une recette qui porte ses propres maillots (fait).
2. ⏳ **Les options affichées viennent encore de l'endpoint** (donc de la base). Il faudra les faire
   venir de `studio.config` avant de pouvoir **supprimer la table équipes** — mais ce n'est pas un
   prérequis de la bascule, seulement du nettoyage final.

<details><summary>Constat d'origine (conservé pour trace)</summary>

### 🚨 DÉCOUVERTE — le lot P5 (écran client) n'est pas fait, et il conditionne la bascule

Vérifié : le thème **n'a pas bougé** depuis les garde-fous du 23/07, et il ne sait toujours pas
afficher un choix dont les options viennent de la recette (`renderChoice` : 0 occurrence).

**Conséquence concrète, une incompatibilité de clés :**

| | Ce que ça produit |
|---|---|
| L'écran client actuel | récupère les équipes via `/api/custom-art/teams` et envoie `teamId` = l'**identifiant numérique** de la base |
| La recette | déclare ses options par **slug** (`psg`, `om`, `real-madrid`…) |

Un vrai client verrait donc sa commande **refusée** (« Le choix teamId est invalide ») — la validation
fait exactement son travail, mais les deux bouts ne parlent pas la même langue.

**Ce que ça ne remet pas en cause** : tout le backend est prêt et prouvé. Un job posté directement
sur l'API avec `teamId=psg` traverse toute la chaîne. C'est le **parcours client** qui manque.

**Ce que ça change** : la bascule exige P5 (renderers d'options déclarées côté thème), ou à défaut
un pont temporaire (clés de recette = identifiants numériques — mais cela ré-attache la recette à la
base, à rebours du modèle « tout dans la fiche produit »).

</details>

### ⛔ Ce qui reste, et qui demande TES YEUX

La parité **déterministe** est prouvée (même prompt, même juge, mêmes images). Reste la parité
**visuelle**, qui ne peut pas être démontrée par un test : le générateur est une IA, deux commandes
identiques ne donnent pas la même image — c'est déjà vrai aujourd'hui.

Le protocole prévu (L6) : **3 séries** de rendus — l'ancien chemin, l'ancien chemin **une seconde
fois**, puis le nouveau. La deuxième série mesure le **bruit de fond** du modèle ; on n'exige du
nouveau que de rester dans cette enveloppe. Sans ce plancher, on imputerait au changement une
variance qui ne lui appartient pas. **Coût : quelques euros de génération. À lancer sur ton feu vert.**

---

## ⛔ ANCIEN point de blocage — levé

Le code est prêt côté moteur. **La suite dépend de données qui ne vivent qu'en production** : les
images de maillots (`kit_ref_urls`) ont été téléversées à la main via l'admin, elles ne sont ni dans
le dépôt ni dans le seeder. Impossible de les deviner.

**Action à faire, sur une machine qui atteint la base de production :**

```bash
node ace studio:export-foot-recipe
```

Cette commande est en **lecture seule** (elle n'écrit ni en base ni sur Shopify). Elle imprime :
1. le **champ de choix** prêt à coller dans `studio.recipe` (une option par équipe, avec sa consigne
   de fidélité) ;
2. la **liste des images à téléverser** dans Shopify Files, avec le **nom canonique** que la recette
   attendra — la recette désigne les images par nom, donc le fichier doit porter exactement ce nom ;
3. la liste **« à trancher avant de coller »** : équipe sans maillot, rôle FACE/DOS non déductible
   du nom de fichier, équipe ayant plus d'images que le worker n'en envoie.

Sans cette sortie, P7 ne peut pas avancer : ni la recette foot, ni la migration des images.

---

## Journal d'avancement

> Tenu à jour à chaque brique livrée. Sert de point de reprise entre sessions.

| Date | Brique | État | Preuve |
|---|---|---|---|
| 23/07 | **Sécurisation préalable** (hors plan) — 3 garde-fous thème : achat nu, job fantôme, dates ambiguës | ✅ déployé + **testé en live par le propriétaire** (horoscope, famille, foot) | thème `816d8d2` |
| 24/07 | **P0.a — kill-switch de rollback** (`STUDIO_GENERIC_DISABLE_PRODUCTS`), dormant | ✅ déployé en prod | back-end `89dcd1c`, run GH `30079020849` = success |
| 24/07 | **P0.b — extension du schéma de recette** (champs `choice`/`number`/`text`, images **par nom** + rôles, notes par option, `printOnArtwork`) | ✅ déployé, **revue adverse passée** (3 défauts corrigés) | back-end `f99c644` |
| 24/07 | **Rig de test + golden permanent** (`npm run test:golden`, câblé au pré-commit) — résorbe la dette ci-dessous | ✅ poussé | back-end `92ec982` |

| 24/07 | **P2 — prompt générique étendu** (rôles d'image, bloc de consignes de fidélité, interpolation des champs + modificateur de casse) | ✅ poussé | back-end `35b3597` |

**Ce que P2 apporte** — `buildGenericPrompt` sait désormais faire, *par les données*, ce que le prompt
foot fait en dur :
1. **annoncer chaque image par son rôle** avec son index d'envoi (« IMAGE 2 montre la vue de FACE de
   Paris »), là où il n'émettait qu'un bloc unique au singulier ;
2. **injecter un bloc de consignes de fidélité** non négociables (note de l'option + consignes communes) ;
3. **interpoler les valeurs des champs déclarés** dans tous les fragments, avec `{playerName:upper}`
   → `WALID` (le foot imprime le prénom en capitales sur le maillot).

La **référence de scène/pose n'est plus un drapeau** : c'est une entrée de rôle `scene`. Si le modèle
refuse une image contenant une personne, l'appelant ne la joint pas et la pose reste décrite en texte —
même résultat qu'`useSceneRef=false`, exprimé par les données.

**Non-régression prouvée avant de figer** : le prompt famille produit par le code d'avant P2 (`92ec982`)
et par le code actuel est **identique** (idem avec les fragments par défaut). Un **instantané du prompt**
(le texte réellement envoyé au modèle) a été ajouté au golden ; l'instantané de recette est inchangé.
**47 assertions vertes.** Le hook de pré-commit a lancé le golden **automatiquement** — le filet posé la
veille fonctionne.

| 24/07 | **P1.a — validation des champs déclarés** (choix / nombre / texte), **synchrone** | ✅ poussé | back-end `9185435` |

**Ce que P1.a apporte** — c'était le chaînon manquant : une recette pouvait *déclarer* des champs
(P0.b) et le prompt *utiliser* leurs valeurs (P2), mais **rien ne validait** ce que le client envoie.
- `choice` : la clé doit exister parmi les options ; le **libellé est figé sur la commande** (si
  l'option est renommée ou retirée plus tard, la commande passée dit toujours ce que le client a choisi).
- `number` : forme stricte `/^-?\d+(\.\d+)?$/` — `Number()` aurait accepté `0x10` (=16) ou `1e3`
  (=1000), or cette valeur peut finir **peinte sur l'œuvre** et doit se lire telle qu'écrite ; puis
  bornes et entier.
- `text` : longueur, jeu de caractères, et **même blocklist** que les tokens et le titre.
- La valeur client n'est **jamais** renvoyée dans un message d'erreur.

**Non-régression prouvée** : sur 6 payloads famille (dont des rejets), la sortie est identique avant
(`35b3597`) et après. **64 assertions vertes.**

#### 🔻 Simplification du plan actée (P1)

Le plan prévoyait de rendre `validateGenericPayload` **asynchrone** (pour aller chercher les équipes en
base) et listait comme risque majeur : *« un `await` manquant sur le chemin qui sert AUSSI la famille =
bypass silencieux de la blocklist et des bornes »*.

**Ce n'est plus nécessaire.** Avec le modèle « tout dans la fiche produit », les options d'un choix
vivent **dans la recette**, déjà en mémoire — aucune lecture externe. La validation **reste synchrone**,
et ce risque majeur **disparaît purement et simplement**. Le choix d'architecture du propriétaire paie
ici directement.

| 24/07 | **P4.a — sélection des images par choix** (résolveur pur : « ce choix → ces images », par nom) | ✅ poussé | back-end `1f01dc8` |

**Ce que P4.a apporte** — la brique qui remplace, côté générique, ce que le legacy foot fait en dur :
*« le client a choisi Paris → joins le maillot de Paris (face + dos), puis la pose »*. Le legacy lit la
table SQL `custom_art_teams` ; ici **tout vient des metafields du produit**. Livré comme **fonction
pure**, isolée du chemin de génération vivant — le branchement dans le worker sera un pas séparé et gardé.

**Deux questions de conception tranchées** (elles étaient en attente dans « À trancher en P4 ») :
1. **Désignation par nom** = correspondance exacte sur le nom de fichier de l'URL CDN, sans query
   string, insensible à la casse. Introuvable **ou ambigu** → **échec net** : une faute de configuration
   ne doit jamais produire une génération silencieusement privée de son maillot.
2. **Images partagées** = nouveau bloc `references` au niveau de la recette (ex. la pose, commune à
   toutes les équipes), joint **après** les images de l'option choisie → le foot retrouve exactement son
   contrat legacy (maillots d'abord, pose en dernier).

**Deux modes, pour ne rien casser** : sans sélection déclarée, le résolveur renvoie **toutes** les images
dans l'ordre de l'admin en signalant `explicit: false` (comportement actuel préservé) ; dès qu'une
sélection est déclarée, seules les images désignées sont jointes, chacune avec son rôle.

**78 assertions vertes**, dont la propriété qui compte : **réordonner `studio.references` dans l'admin ne
change rien au résultat**. Les deux instantanés (recette et prompt famille) sont inchangés.

| 24/07 | **P1.b — persistance des champs sur le job + libellé de repli** | ✅ poussé | back-end `0176eef` |

**Ce que P1.b apporte** — le contrôleur reconstruisait les `inputs` **clé par clé** : les champs validés
en P1.a étaient donc **jetés** avant d'atteindre la base. Ils sont désormais persistés (spread
conditionnel → objet identique pour une recette qui n'en déclare pas). Et `displayLabel` gagne un
**repli sur ces champs** (choix → son libellé figé) : sans lui, une recette sans titre produisait un
libellé **vide**, donc un e-mail atelier, une ligne de revue et un fichier d'impression **sans aucune
identification** — le « piège 8 » signalé par la revue. **83 assertions vertes** (dont 5 sur
`displayLabel`, testé via des stubs Lucid puisqu'il alimente les e-mails et l'impression).

#### ❌ Correction : le honeypot anti-bot n'a JAMAIS manqué

La revue adverse affirmait qu'il était **absent** du chemin générique et le classait en risque majeur
« résolu ». **C'est faux, vérifié ligne par ligne** : le contrôle est fait dans `create()` **avant** le
routage, et `createGeneric` n'a qu'un **seul** point d'entrée — le chemin générique est donc protégé
depuis toujours. Aucun doublon n'a été ajouté. *(Rappel de méthode : les constats de revue se vérifient,
ils ne se croient pas — c'est la deuxième fois qu'un « risque majeur » se dégonfle à la lecture.)*

| 24/07 | **P4.b — branchement du résolveur dans le worker** | ✅ poussé | back-end `2d8346e` |

**Ce que P4.b apporte** — le dernier maillon : `processGeneric` appelle le résolveur, télécharge **seulement**
les images désignées, et passe leurs rôles au prompt. La chaîne **déclarer → valider → choisir → rédiger**
fonctionne désormais de bout en bout.

**Non-régression par construction** : pour une recette sans champs ni sélection (le produit famille LIVE),
le résolveur renvoie `explicit: false` avec **toutes** les images dans l'ordre de l'admin — mêmes URLs,
même ordre, mêmes buffers — et les quatre nouveaux arguments du prompt sont **omis** par spread
conditionnel : l'appel redevient littéralement celui d'avant. Instantanés inchangés.

**Dégradation propre** : une image désignée introuvable ou ambiguë ne fait **pas** planter le job — même
repli artiste que « recette absente », avec un motif explicite. Le client a déjà son jobId.

**⚠️ Le cap `REFERENCES_MAX` reste à 8** — volontairement, contrairement à ce que prévoyait le plan
(« à relever dans le même changement que le branchement »). Raison : en **mode historique** (recette sans
sélection déclarée), toutes les images sont toujours envoyées. Relever le cap maintenant permettrait
encore de charger 30 images sur un produit *sans* sélection et de les envoyer toutes. Le cap sera relevé
**en P7**, quand la recette foot — qui *déclare* sa sélection — sera écrite. C'est le seul moment où il
devient nécessaire, et où il est sûr.

| 24/07 | **L-1 — le golden s'exécute enfin AVANT toute mise en production** (étape CI + déclencheur local élargi) | ✅ poussé | back-end `e040942` |

**🚨 Ce que L-1 corrige, et pourquoi c'était grave.** Une revue adverse a constaté — **vérifié dans le
fichier** — que le workflow de déploiement enchaînait `npm install → build → docker push → deploy`
**sans lancer le moindre test**. Le golden ne tournait donc qu'au **pré-commit local**, et seulement si
`RecipeService.ts` faisait partie du commit. Conséquence : toute la garantie de non-régression sur
laquelle reposent les briques déjà livrées **n'était pas opposable une fois le commit poussé** — une
modification de `genericPrompt.ts`, `referenceResolver.ts`, `Worker.ts` ou `CustomArtJob.ts` partait en
production sans qu'aucun instantané ne soit comparé. Corrigé : étape `Studio golden tests` **avant** la
construction de l'image (un échec bloque le déploiement), et déclencheur local élargi aux 4 fichiers
réellement couverts.

---

## Étude de P3 (le juge) — cartographie faite, lot réorganisé

Une orchestration dédiée a cartographié les deux juges et l'infrastructure partagée, puis conçu et
critiqué la cible. **Conclusion principale : P3 doit être découpé, et son périmètre réduit.**

### Ce qu'est réellement le juge foot (référence de parité)

Module **pur** de 659 lignes, **2 passes Claude en parallèle**, sortie structurée forcée :
1. **Passe rubrique** — 21 champs, sur ≤ 4 images (photo client + ≤ 2 réfs maillot annoncées FACE/DOS +
   **candidat en dernier**), toutes réduites à 896 px.
2. **Passe anatomie** — sur **4 quadrants zoomés du candidat uniquement** (1120 px, agrandissement
   assumé) ; l'image complète est **volontairement absente** (elle permettait au modèle de rationaliser
   une silhouette anormale).

**Fusion** : uniquement `max()` sur les compteurs bras/mains. **Portes dures : exactement 3** (bras > 2,
mains > 2, `anatomy_defect`). **Réussite** = aucune porte + visage ≥ 7 + fidélité maillot ≥ 7 — *rien
d'autre n'est éliminatoire*, pas même l'orthographe du nom. Le reste ne sert qu'au **classement**.

### Les 5 points bloquants relevés (et retenus)

1. **P3 ne peut pas livrer la bascule du foot.** Les plafonds du schéma et la migration des données
   d'équipes en font un lot distinct. → P3 s'arrête à « le moteur reproduit le verdict du legacy sur
   corpus », **hors production**.
2. **Le processus enfant échoue OUVERT** : il ignore les clés qu'il ne connaît pas et retombe sur des
   contrôles par défaut. Un enfant en retard sur le parent jugerait le foot sur un seul critère et
   laisserait passer un candidat à trois bras jusqu'à l'impression. → **discriminant de protocole
   obligatoire**, sortie en erreur sur tout élément inconnu (un enfant en échec = candidat écarté).
3. **Le test en double sur le produit famille LIVE** doit être **strictement encapsulé** : verdict et
   aperçu calculés d'abord, comparaison ensuite dans un `try/catch` total, jamais capable d'écarter un
   candidat.
4. **La CI ne prouvait rien** → corrigé par L-1 ci-dessus.
5. **L'échantillon visuel ne peut rien prouver tel quel** : le juge est une IA sans température fixée —
   deux jugements de la *même* image diffèrent déjà. → mesurer d'abord le **plancher de bruit**
   (legacy vs legacy', même image, même moteur), *puis* n'exiger de la nouvelle version que de rester
   dans cette enveloppe.

### ✅ L0 livré — l'oracle du juge est capturé (back-end `70e9efe`)

Le juge foot est calibré à l'œil : ses seuils **se recopient, ils ne se redécouvrent pas**. Son
comportement est donc figé **pendant qu'il est encore intact** — c'était la seule fenêtre pour le faire.

**Méthode** : `JudgeService` reçoit son client Anthropic par **injection**, ce qui offre une couture
propre. Le service est exercé **en entier et sans aucune modification** — c'est lui l'oracle — avec un
client qui **rejoue des réponses préparées**. Le hasard du modèle est ainsi neutralisé : seul le code
du juge est mesuré.

**Ce qui est figé :**
- **l'assemblage** — 2 appels, outil forcé par passe, modèle et plafond de jetons, 4 images en passe 1
  avec le **candidat en dernier**, 4 quadrants du seul candidat en passe 2, et le prompt qui s'adapte
  au **nombre** de références envoyées (cas à 1 et à 2 références couverts) ;
- **la décision** — 14 cas figés à l'octet près : les 3 portes dures, les seuils à 7, la fusion par
  `max` entre les deux passes, **et les non-portes qui comptent tout autant** (orthographe fausse et
  numéro faux ne sont *pas* éliminatoires côté foot ; membre surnuméraire et mains déformées vus en
  passe 2 ne produisent que de la suspicion).

**L'exécution confirme la cartographie** : le cas « visage 6/10 » rend un score de **7,3**, soit
exactement `0,35×6 + 0,30×8 + 0,20×8 + 0,15×8`. Les pondérations sont *vérifiées*, pas supposées.

Vérifié **falsifiable**. Câblé dans `npm run test:golden` (donc dans l'étape CI) et au pré-commit.
**112 assertions vertes** au total (84 schéma + 28 juge).

### ✅ L0bis livré — l'invariant famille cesse d'être une illusion (back-end `ba81eb1`)

Le golden validait « la famille ne change pas » contre un **littéral écrit à la main** dans le fichier
de test. La recette est désormais une **fixture exportée verbatim** du metafield de production.

**Et la dérive existait déjà.** La copie manuscrite disait
`imageRoles: "IMAGE 1 is the CUSTOMER PHOTO. IMAGE 2 is the STYLE REFERENCE."` là où la production dit
`"Two images are attached. IMAGE 1 is the CUSTOMER PHOTO: it is the ONLY source for the people…"` —
idem pour `countLine`, bien plus riche en production. **Les deux instantanés étaient donc figés sur un
prompt qui n'a jamais été envoyé à un modèle.** Ils reflètent maintenant le texte réellement produit
pour un client. *(À ré-exporter si la recette de production est modifiée volontairement.)*

### ✅ L1 livré — le moteur de décision, pur et **prouvé** (back-end `e654cce`)

Port **littéral** de la logique de décision de `JudgeService.judge()` dans une fonction pure
`conclude(profil, réponses)`, avec les seules **valeurs** extraites dans un profil versionné.
Rien n'est câblé : le juge legacy reste seul en service.

**La preuve** : pour chacun des **14 cas de l'oracle**, `conclude(FOOT_V1)` rend **exactement** le
verdict du legacy — comparaison sur `JSON.stringify` (valeurs *et* ordre des clés, c'est la forme
persistée en base ; un deep-equal ne verrait pas l'ordre). **42 assertions vertes**, oracle inchangé.

**Falsifiabilité vérifiée, et chirurgicale** : abaisser le seuil visage de 7 à 6 fait échouer
*exactement* le cas concerné ; changer une pondération de 0,35 à 0,36 fait échouer *les 14*. Le filet
détecte donc aussi bien une règle isolée qu'une dérive globale.

**Ligne de partage assumée** (et écrite dans le fichier) : le profil porte les **nombres** — seuils,
pondérations, plafonds des portes — c'est ce qu'une recette pourra surcharger. L'**assemblage** du
verdict et la **rédaction** des signaux restent du **code versionné par produit**, cité par son nom.
Les prétendre déclaratifs serait un trompe-l'œil : la liste des 21 champs du foot ne se paramètre pas,
elle s'écrit. *(C'est l'option « l'assumer et le nommer » que la critique recommandait.)*

**Deux non-évidences préservées et documentées** dans le profil : l'orthographe du nom et l'exactitude
du numéro **ne sont pas éliminatoires** côté foot ; un membre surnuméraire vu par la **seule** passe
anatomie ne referme pas la porte. Les durcir « par bon sens » en refondant aurait silencieusement
changé le produit.

`JudgeService.ts` **n'est pas modifié** — il sert d'oracle. Ses types de réponse n'étant pas exportés,
le moteur passe par l'interface publique plutôt que d'y ajouter un `export`.

### ✅ L3 livré — le processus enfant échoue FERMÉ (back-end `25c766e`)

**Le bloquant n°2 de la critique, vérifié ligne par ligne puis corrigé.** L'enfant aiguillait sur
`input.kind === 'generic'` et **retombait silencieusement sur le chemin foot** pour toute autre
valeur, avec des contrôles par défaut (`checks: input.checks || {…}`).

*Conséquence si le protocole évoluait* : un enfant en retard d'une version sur son parent aurait jugé
un candidat sur des règles qui ne sont pas les siennes — et laissé passer **jusqu'au fichier
d'impression** ce qu'il aurait dû recaler. Parent et enfant étant livrés dans la même image, le cas
n'est pas atteignable aujourd'hui ; il le devient **dès la première évolution du contrat**, c'est-à-dire
au lot suivant. D'où un correctif **préalable**.

**Correctif** : discriminant `protocol` + `kind` **obligatoire** (nouveau module pur `judgeProtocol.ts`,
seul point partageable — l'enfant doit rester chargeable hors Adonis). L'enfant **sort en erreur** sur
tout ce qu'il ne reconnaît pas ; le parent traite déjà ce cas (candidat écarté), c'est une dégradation
éprouvée. Le chemin foot, jusqu'ici **défaut implicite**, est désormais nommé explicitement.

**Vérifié en exécutant le vrai enfant compilé** : protocole absent, protocole inconnu (99) et chemin
inconnu (`generic-v2`) sortent tous en **code 4** ; une entrée valide **franchit** le garde-fou et
échoue plus loin, sur le fichier candidat absent — la garde ne sur-rejette donc pas.

**132 assertions vertes.** Les garde-fous ajoutés au golden sont **assumés comme des contrôles de
source** : ils empêchent la disparition accidentelle du contrat, ils ne rejouent pas l'enfant (cela
demanderait de le compiler puis de le lancer — piste notée pour la suite).

### ✅ L0-bis (juge) livré — l'oracle du juge qui contrôle la FAMILLE (back-end `0a37dc7`)

Le juge foot avait son oracle ; celui-ci fige le **juge générique**, c'est-à-dire celui qui décide
aujourd'hui si le poster d'un **vrai client** part à l'impression ou repart en génération.

**13 cas figés**, dont le **contraste** qui compte avec le foot : ici la moindre faute de texte est
**éliminatoire** (prénom absent, mal orthographié, ordre gauche-droite non respecté, titre fautif) —
là où le foot ne recale pas sur l'orthographe. Sont aussi couverts : le **résidu de la référence de
style qui fuite** sur l'œuvre (distingué du texte parasite), le comptage de figures, le seuil de
qualité à 6, et les deux contrôles désactivables par la recette.

**Assemblage figé aussi** : une seule passe, une **seule image** (le candidat), jamais la photo client
ni les références — c'est ce qui distingue structurellement ce juge du juge foot.

**155 assertions vertes** sur les trois suites, toutes lancées par l'étape CI et au pré-commit.

### 🔻 Correction de plan — ce qui s'unifie vraiment, et ce qui ne s'unifie pas

Le plan supposait un **moteur de décision commun** aux deux juges. La comparaison des deux
implémentations, faite après avoir capturé les deux oracles, **infirme cette hypothèse** :

| | Juge foot | Juge générique |
|---|---|---|
| Modes d'échec | **un** (portes anatomiques) | **deux** (texte/figures **et** qualité) |
| Préfixes de motif | 1 | 2 distincts |
| Éliminatoire sur l'orthographe | **non** | **oui** |
| Images vues | 4, sur 2 passes | 1, sur 1 passe |

Ces règles ne sont pas des variantes d'un même barème : ce sont **deux produits différents**. Les
forcer dans un `conclude()` unique produirait une **fausse abstraction** — de l'indirection en plus,
aucune duplication en moins. C'est exactement le travers que la critique nommait (« `report` absorbe
tout ce qui discrimine »).

**Ce qui s'unifie réellement, et qui a de la valeur :**
- le **transport** et l'isolation en processus enfant *(déjà partagés ; durcis en L3)* ;
- l'**orchestration multi-passes** et la **préparation des images par rôle** — c'est ce qui manque au
  chemin générique pour servir le foot ;
- le **classement** des candidats *(déjà partagé)* et la **comptabilité de coût**.

**Ce qui reste, à raison, du code versionné par produit** : les règles de décision elles-mêmes. La
recette **choisit un profil par son nom** et en **règle les nombres** — c'est la promesse tenable.

**Conséquence sur les lots** : `L4`/`L5` ne visent plus à fusionner les décisions, mais à porter
l'**orchestration multi-passes + images par rôle** dans le chemin générique. `FOOT_V1` (L1) garde
toute sa valeur : il extrait les nombres du foot et **prouve** la parité de sa décision.

### ✅ L4 livré — le juge générique peut enfin VOIR ce qu'il juge

Trois commits (`0e65b80`, `3046c87`, `ff1cab5`) qui complètent la chaîne côté juge :
1. **Le juge générique accepte** la photo du client et des références **annoncées par rôle**
   (face/dos/scène/style), le candidat restant la **dernière** image — contrat partagé avec le foot.
   Un **manifeste unique** alimente à la fois l'assemblage du message et le prompt qui les annonce :
   s'ils divergeaient, le juge noterait des images qu'on ne lui a pas montrées. Un test le vérifie.
2. **Le transport les achemine** : photo et références passent par des **fichiers** (jamais en base64
   dans un argument de processus), et le **protocole passe à 2**. Le bump est indispensable bien que
   les champs soient facultatifs — un enfant resté en version 1 les aurait ignorés en silence et
   noté la fidélité d'une référence jamais vue. C'est exactement le fail-open que L3 a fermé.
3. **La recette décide** : `judge.seesReferences`. Sans ce réglage, le juge ne voit que le candidat,
   **comme aujourd'hui** — le produit famille est inchangé. Le foot, lui, en a besoin : sans les
   maillots sous les yeux, un juge note un design qu'il n'a jamais vu.

*Au passage, correction d'un de mes tests : une assertion **figeait** la version du protocole à 1,
alors que cette constante est faite pour être incrémentée. Le vrai invariant — parent et enfant lisent
la **même** constante — était déjà couvert par les garde-fous de source.*

**168 assertions vertes** sur 3 suites, exécutées en CI avant chaque image poussée.

**➡️ Reste de P3 :** `L5` (le chemin générique ne sait faire qu'**une** passe ; le foot en exige deux)
puis `L6` (preuve visuelle en 3 séries — mesurer le **plancher de bruit** du juge avant tout critère).

### 🔻 L5 réorienté — réutiliser le juge foot, plutôt que le réécrire

Le plan prévoyait de porter la **capacité multi-passes** dans le juge générique. En l'abordant, une
voie bien plus sûre apparaît, et elle découle directement de la correction déjà actée (*les décisions
ne s'unifient pas, la plomberie si*) :

> **Le juge foot n'a pas à être réécrit — il doit être réutilisé.** C'est un module **pur** de 659
> lignes, déjà calibré, déjà protégé par son oracle. Le chemin générique n'a pas besoin d'apprendre
> à faire deux passes : il doit savoir **appeler ce juge-là** quand la recette le demande, en lui
> fournissant ses entrées depuis la recette (option choisie, champs déclarés, références résolues)
> au lieu des colonnes historiques du job.

Bénéfice : **aucune re-calibration**, aucune réimplémentation des 4 quadrants zoomés ni des 21 champs,
et le risque tombe à celui d'un simple câblage. Le « moteur unifié » devient un **aiguilleur** qui
choisit une implémentation de jugement — ce que la comparaison des deux juges imposait de toute façon.

**Livré (`0b82aa3`)** : le juge foot accepte des **rôles d'image déclarés**, prioritaires sur sa
déduction par suffixe de nom de fichier. Une convention de nommage est fragile — un fichier renommé
perdrait son sens ; une déclaration, non. Le test donne des noms de fichiers disant l'**inverse** des
rôles déclarés et vérifie que la déclaration gagne. Sans rôles, la déduction historique est intacte.

**✅ L5 terminé (`e0f8743`) — l'aiguillage est en place.** Une recette peut citer un profil de
jugement par son nom (`judge.profile`). Quand elle le fait, le chemin générique **appelle le juge
foot** au lieu du juge générique. Les entrées ne viennent plus des colonnes historiques du job mais
de la recette : les champs marqués `printOnArtwork: back-name` / `back-number` fournissent le texte
peint, l'option choisie fournit ses images (**rôles déclarés**, protocole 3) et sa consigne de
fidélité. Le coût comptabilisé suit le profil emprunté.

**Fail-closed à deux niveaux** : une configuration incomplète (photo absente, champ `printOnArtwork`
manquant) **lève** → le candidat est écarté, dégradation déjà éprouvée ; et un nom de profil inconnu
est **refusé à la validation de la recette**, plutôt que de retomber en silence sur un jugement qui
n'appliquerait pas les règles demandées.

**🎯 La parité du juge est atteinte au niveau du code.** Il reste à la **prouver** (L6).

### Découpage retenu pour P3

`L0` capturer l'oracle (legacy **intact**) · `L0bis` figer la **vraie** recette famille de production
(l'instantané actuel est une copie tenue à la main) · `L1` registre + moteur pur · `L2` schéma + validations ·
`L3` transport avec protocole versionné · `L4` bascule 1 passe + test en double encapsulé · `L5` multi-passes
+ portage foot · `L6` preuve visuelle en 3 séries.

**➡️ Faits : P0, P1 (a+b), P2, P4 (a+b), L-1.** Reste :
- **P3** — juge configurable (le plus gros poste, 9-14 j) ;
- **P1.c** — coexistence `/jobs/last` (ne vaut qu'au moment de la bascule, à faire juste avant P9) ;
- puis **P7→P10** : recette foot + migration des images, preuve de parité, bascule, suppression du legacy.

**Preuve de non-régression de P0.b** — un banc d'essai charge le code **avant** (git HEAD) et **après**
(arbre de travail), fait parser la **vraie recette du produit famille en production** par les deux, et
compare : `JSON.stringify` **strictement identique** (valeurs *et* ordre des clés), aucune clé `fields`
ajoutée (tableau vide compris). **35 assertions vertes**, dont 20 recettes malformées rejetées.
*(Banc d'essai dans le scratchpad de session ; à pérenniser — voir « Dette assumée ».)*

**Défauts trouvés par la revue adverse et corrigés avant commit :**
1. **Le cap `REFERENCES_MAX` reste à 8** (je l'avais relevé à 40). Le relever maintenant armait un
   piège : le worker envoie **aujourd'hui toutes** les références sans aucun tri — 15 maillots rangés
   dans le metafield auraient envoyé 16 images au modèle avec un prompt qui n'en annonce qu'une.
   → À relever **en P4 seulement**, dans le même changement que le branchement de la sélection par nom.
   *(Le commentaire que j'avais écrit pour justifier le relèvement était factuellement faux.)*
2. **`min`/`max` exigent `typeof number`** — `Number(null)` valait `0`, donc `min: null` devenait une
   borne fantôme au lieu d'être refusé. Idem `maxLength`.
3. **Bornes fractionnaires refusées si `integer: true`** — `min:1.2, max:1.8` définissait un domaine
   vide : un champ requis que le client n'aurait jamais pu satisfaire.
+ durcissements : membres d'`Object.prototype` ajoutés aux noms réservés, `CHOICE_OPTIONS_MAX` aligné
sur le cap de références, `inputs.fields: []` traité comme absent.

### Ajustements de plan décidés en cours de route

1. **P0 scindé en P0.a (kill-switch) et P0.b (schéma)** — livrer le rollback *avant* toute brique
   structurante, pour ne jamais coder sans filet.
2. **`providerChain[]` et `judge.passes[]` retirés de P0**, reportés en **P3/P4** (leurs consommateurs).
   *Motif :* figer aujourd'hui la forme d'un schéma dont le consommateur n'existera que dans plusieurs
   semaines, c'est se condamner à le casser. Le schéma des champs, lui, est consommé tôt (P2 prompt,
   P4 worker) — il est donc mûr. **Aucun impact sur le chiffrage global** (travail déplacé, pas ajouté).

### À trancher en P4 (soulevé par la revue adverse de P0.b — ne pas redécouvrir)

Le schéma sait **désigner** des images ; le **branchement** reste à faire. Ces points devront être
tranchés au moment de câbler la sélection dans le worker :

1. **Sémantique du « par nom »** : correspondance exacte du nom de fichier, ou fragment distinctif ?
   Que faire si aucune image ne correspond (recette invalide ? génération refusée ?) ou si plusieurs
   correspondent ? → doit être **fail-fast**, jamais un silence.
2. **Références partagées** : aujourd'hui une image ne peut être désignée que *sous une option*. Or la
   **référence de pose** du foot est commune à toutes les équipes. Deux voies : soit « toute référence
   non réclamée par une option est jointe systématiquement », soit un bloc explicite. À décider.
3. **Option active / inactive** : le legacy filtre côté serveur (`.where('active', true)`, « Équipe
   inconnue » sinon). Le schéma n'a pas d'équivalent → une équipe retirée doit être retirée des options.
4. **Cap des notes à 600 caractères** (le legacy tolérait 2000) : à vérifier contre les vraies
   `fidelity_notes` avant migration, sinon une équipe verbeuse ferait échouer la recette.
5. **Contrat d'ordre prompt ↔ juge** : le legacy est positionnel (image 1 = photo client, 2..n =
   maillots, dernière = scène). Le nouveau schéma ordonne les images *dans* une option — l'ordre final
   envoyé au modèle doit rester **identique** entre le prompt et le juge.

### Dette assumée (à résorber)

- ~~Le back-end n'a aucune suite de tests exécutable~~ → **RÉSORBÉE le 24/07** (back-end `92ec982`).
  `npm run test:golden` : test de non-régression **permanent** du schéma de recette, sans aucune
  infrastructure (ni base, ni `.env`, ni démarrage de l'app — le TypeScript est transpilé en mémoire
  et les imports Adonis stubbés, car `parseRecipe` est une fonction pure). Câblé dans `lint-staged` :
  il tourne au **pré-commit** dès que `RecipeService.ts` change. `-- --update` régénère l'instantané
  quand la dérive est voulue.
  *Deux vérifications faites sur le test lui-même :* (a) l'instantané figé produit le **même** résultat
  avec le code d'avant P0.b (`89dcd1c`) qu'avec le code actuel — on ne fige donc pas une régression ;
  (b) le test est **falsifiable** (dérive injectée → échec + code de sortie 1).
- **Reste à couvrir** : ce golden protège le *parsing*. Les étages qui **consomment** la recette
  (prompt, worker, juge) n'ont toujours aucun test — à traiter quand P2/P3/P4 les toucheront.

---

## 0. Objectif & principe directeur

Aujourd'hui le studio a **deux moteurs** :
- le **générique** (piloté par les metafields `studio.config` / `studio.recipe` / `studio.references`) — produit famille `10565374247259`, LIVE ;
- le **legacy foot** codé en dur (`prompt.ts`, table `custom_art_teams`, endpoint `/api/custom-art/teams`, juge 2 passes) — produit foot `10528685621595`, LIVE.

Le routage bascule sur **la présence d'une `studio.recipe`** sur le produit ([CustomArtController.ts:187](../MyselfMonArt_Backend/app/Controllers/Http/CustomArtController.ts)).
Cible : **étendre le générique jusqu'à la parité foot**, migrer le foot dessus, puis **supprimer le legacy**.

**Levier de sûreté central :** tant que le produit foot n'a **pas** de recette, il reste legacy. Donc **toute l'extension
du moteur (P0→P8) est additive, dormante et déployable en prod** sans toucher ni la famille ni le foot. La bascule
(P9) est un acte séparé, outillé et réversible. La suppression du legacy (P10) est la toute dernière étape.

### 0.1 Le modèle de données retenu — « tout-en-références, par nom » (décision du 22/07)

C'est le cœur de la révision. **Toutes** les images vivent dans le metafield produit **`studio.references`** (une seule liste),
et la recette y renvoie **par nom**, pas par position :

- **Où sont rangées les images ?** Dans le tiroir `studio.references` du produit — y compris les photos de maillots et la
  photo de pose. Plus aucune image ni donnée d'équipe dans la base de données du backend.
- **Adressées par NOM, jamais par numéro d'ordre.** Chaque image porte un nom stable (son nom de fichier / une clé). Réordonner
  la liste ne casse jamais rien. Une équipe qui a deux photos (face + dos) = deux images nommées (`paris-face`, `paris-dos`).
- **La recette relie un choix à ses images + ses notes.** `studio.recipe` déclare, pour chaque option d'un choix
  (ex. « Paris »), quelles images nommées elle utilise, leur rôle (face/dos/pose), et sa note secrète (« Paris = bande centrale »).
- **Les libellés vus par le client (noms d'équipes, couleurs) vivent dans `studio.config`** — déjà injecté dans la page.
  Le sélecteur d'équipe lit ces options **en ligne**, sans appeler d'endpoint. Les photos de maillots, elles, restent lues
  **uniquement par le backend** au moment de générer (jamais montrées au client, comme aujourd'hui).
- **On envoie à l'IA seulement le sous-ensemble utile** (la pose + les 1-2 maillots de l'équipe choisie + la photo du client),
  même si 30 images sont stockées dans la liste. Stocker beaucoup ≠ envoyer beaucoup.
- **Deux « infos » à ne pas confondre.** (1) Le **catalogue** — quels maillots/équipes existent — vit sur la **fiche produit** (ci-dessus).
  (2) Ce que **chaque client choisit** pour SA commande (son équipe, son prénom, son numéro) est attaché à **sa commande** : à
  l'ajout au panier, ces choix partent en **propriétés de commande** et s'affichent sur la commande dans l'admin Shopify — exactement
  comme aujourd'hui. **Quelles** infos apparaissent sur la commande se déclare aussi depuis la fiche produit (dans `studio.config`).
  Rien de tout ça ne passe par la base de données.

**Conséquence directe :** le code **cesse d'utiliser** la table `custom_art_teams`, sa page d'admin et l'endpoint
`/api/custom-art/teams` (plus aucune lecture/écriture sur le chemin live — tout se lit depuis les metafields du produit).
⚠️ **Le plan ne SUPPRIME pas la base de données** : elle est laissée en place, dormante ; **le propriétaire la supprimera à la
main plus tard** (décidé 22/07 — même règle que les colonnes foot : on cesse d'utiliser, on ne détruit jamais de données).
Pour changer un maillot, ajouter une équipe ou créer un tout nouveau produit personnalisé : on édite les metafields de la fiche
produit — **zéro backend**. Le moteur qui sait lire « ce choix → ces images nommées » se construit **une seule fois** (c'est ce
plan) ; ensuite, tout est en self-service.

> La friendly-UI pour éditer ces metafields sans écrire de JSON à la main, c'est l'outil « poster personnalisé » du Publisher
> (webapp) — hors périmètre de ce plan-ci, mais c'est là que la saisie confortable vit (voir [[publisher-poster-personnalise]]).

### 0.2 Ce que le générique NE SAIT PAS encore faire (l'écart à combler)
Vérifié (workflow du 21/07, verdict + 2 contre-épreuves non réfutées) :
1. **choix discret → sous-ensemble d'images** (équipe → maillot) : aujourd'hui `studio.references` sont toutes jointes, sans sélection par choix ;
2. **nombre borné imprimé** (numéro 1-99) : aujourd'hui seulement un texte, sans type ni placement ;
3. **notes par-choix** (astuce de fidélité par équipe) : la recette est un objet statique ;
4. **rôles face/dos par-image** : `imageRoles` est un bloc unique, le juge ne voit jamais les références ;
5. **juge vision 2 passes** (anatomie/ressemblance/fidélité maillot) + **chaîne multi-providers** : le générique = 1 passe, 1 provider ;
6. **UI** : les types `choice`/`group` n'ont **aucun renderer JS** (seuls text/number/date) ; panneaux team/maillot codés en dur en Liquid.

### 0.3 ⚠️ SECTION PÉRIMÉE — corrigée par le §0.4 (vérification live du 22/07). NE PAS S'Y FIER.

*(Conservée pour trace : elle concluait à tort que les produits horoscope/anciens foot tournaient sur un vieux système
séparé. C'était une erreur de lecture — l'API Shopify ne renvoyait que les 20 premiers metafields et `studio.config`
était au-delà. Lire le §0.4.)*

### 0.3-bis Périmètre présumé (ERRONÉ) — deux systèmes de personnalisation

Le magasin a **deux mécanismes distincts**, à ne surtout pas confondre :

- **Système A — vieux formulaire `product.customer_details`** (design-fixe, **PAS d'IA, PAS le studio**) :
  les **~12 posters Horoscope bébé** (un par signe : Scorpion 9257…, Poisson, Lion, Capricorne, Cancer, Gémeaux,
  Balance, Bélier, Sagittaire, Verseau, Vierge, Taureau), **+ les anciens foot** « Foot Coloré » (9199…) et
  « Foot Noir et Blanc » (9361…). Le client remplit un petit formulaire (prénom/date/… ou prénom+numéro) → propriétés
  de commande → impression sur un visuel **FIXE** (un par produit, déjà dessiné). Rendu par un **autre bloc de thème**,
  jamais par `tw-custom-art-studio`, et **aucun** job CustomArt (donc l'aval `_job_id` ne les voit pas).
  **➡️ Ce système n'est PAS touché par l'unification du studio : ces produits marchent exactement comme aujourd'hui, sans qu'on y touche.**

- **Système B — le STUDIO** (`studio.config`/`recipe`/`references`, moteur CustomArt, génération IA) : exactement
  **DEUX produits** — **famille** (10565…, générique) et **foot « joueur de légende »** (10528…, legacy). **C'est le périmètre de ce plan.**

**Conséquence :** ce plan unifie le Système B (migrer le foot, garder la famille identique). Horoscope et les anciens foot
restent sur le Système A, intacts.

*(Fin de la section erronée.)*

### 0.4 ✅ PÉRIMÈTRE RÉEL — vérifié EN PRODUCTION le 22/07/2026

**La quasi-totalité de l'unification est DÉJÀ FAITE.** Vérifié en lisant la config réellement injectée dans la page live
du produit « SCORPION Horoscope » (inspection JS du DOM, pas une déduction) :

```json
{"version":1,"productType":"poster-bebe-horoscope","generation":{"enabled":false},
 "steps":[firstName(text), birthday(date), birthtime(time), height(number), weight(number), format]}
```
— avec libellés `cartProperty` **en 5 langues**. Les panneaux `photo`/`team`/`name` vus dans le DOM sont les **4 panneaux
Liquid codés en dur, présents mais INACTIFS** sur tout produit studio : leur présence ne prouve rien.

**État réel du magasin :**

| Produits | Rail | Génération | Statut |
|---|---|---|---|
| 12 Horoscope bébé + 2 anciens foot (Coloré, N&B) | **STUDIO** (`studio.config`) | `generation.enabled:false` — **design-fixe, pas d'IA** | ✅ **déjà unifié** |
| Famille (dessin au trait) | **STUDIO** (`studio.recipe`) | générique, IA | ✅ **déjà unifié** |
| **Foot « joueur de légende »** (10528…) | **LEGACY codé en dur** | IA + équipe | ❌ **seul produit restant** |

**Conséquences :**
1. **La « Phase 2 » (migrer les 14 produits) est SANS OBJET — elle est déjà en production. Chiffrage : 0 j.**
   Le metafield `product.customer_details` est un **résidu** inutilisé (son JS `frontend/store/customerDetails.js` a été
   supprimé au commit cc2cf81).
2. **« Tout unifier » se réduit donc au plan Phase 1 : migrer le foot « joueur de légende ».** Le chiffrage global reste
   celui du §1.

**🚨 DEUX PIÈGES À GRAVER (issus de l'audit) :**
- **Supprimer `studio.config` n'est JAMAIS un rollback.** Sans config, le moteur retombe sur `FOOT_FALLBACK_STEPS`
  → parcours **foot avec IA + demande de photo d'enfant** sur n'importe quel produit. Un rollback se fait en **restaurant
  la config précédente**, jamais en la vidant.
- **`growth/studio-configs/horoscope.json` est un brouillon PÉRIMÉ et DANGEREUX** (productType différent, `time_of_birth`
  vs `birthtime`, `size` vs `height`, **aucun** bloc `generation`, **aucun** `cartProperty`). Le coller sur les 12 fiches
  **rebasculerait le studio en génération IA** et enverrait des **lignes de commande vides**. Ne jamais l'utiliser.

---

## 1. Chiffrage (synthèse)

| Phase | Intitulé | Estimation (j-dev) |
|---|---|---|
| **P0** | Fondations schéma v2 + références nommées + kill-switch + discipline de version (dormant) | **6-9** |
| **P1** | Persistance & reprise génériques + honeypot anti-bot + coexistence `/jobs/last` + validation async sûre | **5-7** |
| **P2** | Prompt générique étendu (rôles, notes, interpolation, réf pose) | **3-4** |
| **P3** | Juge vision configurable (passes déclaratives, voit-les-réfs, anatomie) + sous-lot évaluateur d'expressions | **9-14** |
| **P4** | Worker : chaîne multi-providers, réf pose, résolution des images par-choix **depuis les références (par nom)** | **5-8** |
| **P5** | Renderers UI config-driven (choice options **en ligne**, group, aperçu, panier) + canal de déploiement confirmé | **8-12** |
| **P6** | Aval dé-footballisé (mapper centralisé, 3 lecteurs, garde anti-vide) | **4-6** |
| **P7** | Recette foot v2 + **migration des images vers Shopify Files** + relâchement des gardes + consent + tolérance payload legacy | **4-6** |
| **P8** | Shadow-test + preuve de parité 3 couches (assembleur pur convergé) | **6-10** |
| **P9** | Cutover atomique-outillé + soak/drain (kill-switch + front drainé) | **2-4** |
| **P10** | Backfill + suppression du legacy foot **+ arrêt d'usage de la table/admin/endpoint équipes** (suppression DB manuelle par le propriétaire) | **4-6** |

- **Coding pur : ~56-86 j-dev.** *(Allégé vs la 1re version : l'ancienne phase « admin catalogue » ~2-4 j disparaît ; en échange, une petite migration d'images entre dans P7.)*
- **+ ~20-30 % de friction non-codante** (1 seul dev, backend auto-deploy à chaque push `main`, front en double surface, zéro-régression sur 2 produits LIVE, revue adverse imposée, gating CI) → **~67-108 j-dev réels (~13-22 semaines à 1 dev).**
- **Hors chiffrage dev :** 2-4 semaines **calendaires** de soak/drain entre le cutover (P9) et les points de non-retour (P10) ; la **décision produit « consent »** (dépendance propriétaire).
- **Gros postes :** P3 (juge, 659 lignes calibrées), P5 (front, 3667 lignes 100 % foot en dur), P8 (assembleur touchant le foot LIVE), P0 (contrat fondateur).

> ⚠️ Le chiffrage reste dominé par la **réimplémentation** (juge configurable, renderers UI, liaison choix→images) — pas par le stockage des images. Le modèle « tout-en-références » simplifie et retire de la surface backend, mais ne réduit pas le gros du travail moteur.

---

## 2. Les phases en détail

### P0 — Fondations schéma v2 + références nommées + kill-switch + discipline de version — 6-9 j · *dépend de : —*
**But :** étendre `StudioRecipe`/`parseRecipe` pour les constructs manquants, **rendre `studio.references` adressable par nom**, et livrer dès maintenant les deux garde-fous du cutover.
- Interface `StudioRecipe` étendue (types de champ `choice`/`number`, liaison option→images nommées, rôles d'image, `providerChain[]`, `judge.passes[]`) — **tout optionnel**.
- `parseRecipe` : absent ⇒ objets vides ⇒ **recette v1 identique** (famille intacte).
- **Références nommées :** `studio.references` reste le tiroir unique, **cap relevé** (8 → ~40) ; résolution **par nom de fichier / clé** (pas par position). Un champ `choice` déclare, par option, la liste des noms d'images + rôles + note.
- **Discipline de version :** rester en `version:1` additif, **ne PAS bumper `SUPPORTED_VERSION`** (sinon un revert de build parse la recette posée comme *invalid* → 422 sans repli legacy).
- **Kill-switch dur :** env-var `STUDIO_GENERIC_DISABLE_PRODUCTS` évaluée **en premier** dans `resolveGenericRoute`, forçant le legacy quel que soit le metafield, lue par les **deux process PM2** (app + cron).
- `JUDGE_SCHEMA_REGISTRY` serveur (formes de réponse du juge citées par nom — c'est du « comment le juge lit », pas de la donnée par-produit).
- **Test CI golden schema** : la recette FAMILLE live parse en objet bit-à-bit identique.
- *(Supprimé vs 1re version : plus de `CatalogRegistry`/table `custom_art_teams`/migration `set` — remplacés par les références nommées.)*

**Sûreté prod :** 100 % additif et dormant ; famille byte-identique (golden schema CI).

### P1 — Persistance & reprise génériques + honeypot + coexistence `/jobs/last` + validation async — 5-7 j · *dépend de : P0*
- Persister les entrées structurées dans `inputs.fields` (choix = clé stable + libellé snapshoté, numérique, texte) ; `displayLabel`/reprise dérivés **sans branche par-produit**.
- **Honeypot anti-bot** (champ caché `website`, aujourd'hui foot-only) porté dans `createGeneric` — sinon perte de protection au cutover.
- `validateGenericPayload` devient **async** ; **gate CI `no-floating-promises`** + audit de tous les callers (un `await` manquant sur le chemin famille = bypass sécurité).
- **Coexistence `/jobs/last`** : le filtre doit matcher **à la fois** les jobs legacy (`product_type` NULL) et le nouveau `productType` foot pendant tout le drain.

### P2 — Prompt générique étendu — 3-4 j · *dépend de : P0, P1*
- `buildGenericPrompt` porte les **rôles par-image** (face/dos/pose/style), le bloc **notes** fusionné, l'**interpolation** des champs déclarés (`{playerName}`, `{playerNumber}`, majuscules), et le **gating pose** texte-vs-image selon la capacité provider.
- **Test snapshot** figeant le prompt calibré de la famille LIVE. `buildMasterPrompt` foot reste en place, inchangé.

### P3 — Juge vision configurable — 9-14 j · *dépend de : P0, P1, P2*
> Poste le plus lourd : `JudgeService.ts` = 659 lignes calibrées par audit visuel.
- Juge paramétrable par recette : **N passes parallèles**, images par passe, mode « voit-les-références », module **anatomie 4-quadrants**, seuils/gates, fusion « pire cas », poids de score — dans le **process enfant isolé** (sans réintroduire de plantage sharp/libvips).
- **Sous-lot évaluateur d'expressions** (petit langage de conditions) chiffré à part (~2-3 j), testé isolément.
- **Vérification de non-régression** : bench visuel prouvant que les seuils foot config-driven **reproduisent à l'identique** le verdict de référence (on ne re-règle rien ; on prouve qu'on a tout recopié fidèlement).

**Sûreté prod :** **opt-in strict** — sans `judge.passes` le juge reste 1 passe (comportement famille inchangé).

### P4 — Worker : chaîne multi-providers, réf pose, images par-choix (par nom) — 5-8 j · *dépend de : P1, P2, P3*
- **Résolution des images depuis `studio.references` par NOM** : l'option choisie déclare des noms (`paris-face`, `paris-dos`) → le worker filtre la liste des références déjà chargée, **sans lookup base de données** (plus simple qu'avant). Notes de l'option injectées au prompt + juge.
- **Chaîne providers opt-in** : absente ⇒ single provider (refus → revue manuelle) ; présente ⇒ chaîne + secours + round 2 silencieux.
- **Réf pose opt-in**, attachée uniquement aux providers qui acceptent une référence de personne.

**Sûreté prod :** **ne jamais defaulter** `providers`/`pose` (defaulter = régression coût + comportement famille).

### P5 — Renderers UI config-driven + canal de déploiement confirmé — 8-12 j · *dépend de : P0, P1*
> `component-custom-art-studio.js` = 3667 lignes, `choice`/`group` 100 % foot en dur.
- **Pré-requis (décidé 22/07) :** le front studio se déploie via **un outil/une commande** (Shopify CLI ou GitHub), sur le **thème Shopify** `tw-custom-art-studio.liquid` (*pas* l'éditeur en ligne, *pas* `sync-prod.js`) ; le cache-busting `?v=hash` passe par cet outil. Confirmer la commande exacte avant de coder.
- Renderers JS pour **choice** (options **lues en ligne depuis `studio.config`**, grille, recherche — **plus besoin d'endpoint**) et **group** ; aperçu maillot généralisé en registre de templates ; sémantique **number** bornée ; **propriétés panier** depuis les champs déclarés (suppression du trio `prop_name/number/team` en dur) → les choix (équipe/prénom/numéro) **continuent d'apparaître sur la commande** dans l'admin Shopify, à l'identique d'aujourd'hui.
- **Consent auto-envoyé** par le front config-driven (décision 22/07 : pas de case obligatoire) — simplifie le cutover ; garder la mention de confidentialité visible.
- Versioning `?v=hash` + check CI d'égalité des hash servis (sinon cache 4 h → désync au cutover).

**Sûreté prod :** `family.config.json` n'a ni choice ni group → renderers non déclenchés, zéro régression.

### P6 — Aval dé-footballisé (mapper centralisé) — 4-6 j · *dépend de : P1*
- **Grep exhaustif** des lecteurs de `team_id|player_name|player_number` : **3 lecteurs** — `WebhooksController`, `CustomArtPrintAdminController`, **et `CustomArtReviewAdminController`** (le 3e, trouvé par la contre-épreuve).
- `buildOrderMailItem(job)` **unique** dérivant de `inputs.fields`/`displayLabel` ; remplace les 3 lecteurs.
- **Garde runtime anti-vide** : refuse d'émettre un print/email vide (alerte au lieu de blanc) ; sur job legacy, lit les colonnes foot **à l'identique** (prouvé par test).
- Copie email paramétrable par famille ; `resumeUrl` dérivé de `inputs.productId`.
- **Merge gaté derrière un shadow-check** sur jobs legacy réels.

### P7 — Recette foot v2 + migration des images + relâchement des gardes + consent — 4-6 j · *dépend de : P0, P2, P3, P4, P5*
- **Migration des images (une seule fois)** : re-téléverser les ~30 photos de maillots (aujourd'hui en base/DO Spaces) comme **fichiers Shopify**, dans la liste `studio.references` du produit foot, **nommées** (`paris-face`, `paris-dos`, `scene-pose`…).
- Rédiger la **recette foot v2** (première composition réelle des constructs) : choix `teamId` dont chaque option liste ses images nommées + note + rôles ; `text playerName` imprimé ; `number playerNumber` 1-99 imprimé ; réf pose ; chaîne 3 modèles ; juge 2 passes ; titre requis.
- **`studio.config`** foot config-driven : options d'équipes (noms + couleurs) lues en ligne par le sélecteur, plus d'appel endpoint. **Marquer équipe / prénom / numéro comme « à afficher sur la commande » (`cartProperty`)** → ils apparaissent sur chaque commande dans l'admin Shopify, comme aujourd'hui.
- Relâcher le fail-fast « ≥1 `studio.references` » et l'ancienne exigence (une recette tire ses images des choix nommés).
- **Consent — décidé (22/07) : accord automatique** → `recipe.requireConsent=false` pour le foot ; le front envoie le consentement automatiquement (pas de case obligatoire), comme aujourd'hui. Conserver la mention de confidentialité visible (photo supprimée, pas d'entraînement IA).
- **Tolérance payload legacy** : avec `requireConsent=false`, le consentement n'est plus un motif de 422 ; le chemin générique accepte la forme foot legacy **jusqu'au drain complet** du front (filet pour le reste du payload).

**Sûreté prod :** recette rédigée et validée en test/staging, **posée sur AUCUN produit réel** à cette phase. Les images migrées ne servent qu'une fois la recette posée (P9).

### P8 — Shadow-test + preuve de parité 3 couches — 6-10 j · *dépend de : P6, P7*
> La génération est non-déterministe → **l'égalité pixel est exclue** ; on prouve l'égalité du **contrat déterministe** (mêmes appels, mêmes images/rôles, mêmes réglages du juge, mêmes verdicts).
- **Refactor à risque isolé** : extraire l'assemblage du contrat (prompt + montage refs/juge) en **une fonction pure** appelée par legacy ET générique ; touche le foot LIVE → **gaté par golden-corpus avant tout le reste**.
- **Couche 1 — golden-corpus CI** : prompt maître à l'octet près, mêmes noms/ordre/rôles face-dos, notes, réglages+images du juge, chaîne, rounds, verdicts. Cas-pièges : blocklist, bornes 1 & 99, piège « I », accents, **honeypot rempli → rejet**.
- **Couche 2 — shadow-diff prod** : pour chaque vrai job foot legacy servi, calculer le contrat générique en parallèle et **logger tout écart sans jamais le servir** ; objectif zéro-écart soutenu.
- **Couche 3** : produit Shopify de **test caché** portant la recette v2 (le foot **réel reste sans recette**) ; rendus sur cas limites + **validation visuelle propriétaire** + baseline KPI.

### P9 — Cutover atomique-outillé + soak/drain — 2-4 j · *dépend de : P8*
Ordre **imposé** :
1. **Pré-bascule :** déployer le nouveau front partout, versionner les assets, **laisser le cache 4 h expirer / forcer le rechargement**. Ne **jamais** poser le metafield tant qu'un client peut servir l'ancien front sans consent.
2. **Vérifier le kill-switch** actif sur app + cron.
3. **Bascule :** poser `studio.recipe` v2 sur le produit foot **réel** ; sous ≤5 min le trafic route vers le moteur unifié.
4. **Rollback à deux niveaux :** (a) **immédiat** = armer le kill-switch ; (b) **propre** = vider le metafield.
5. **Soak** contre le baseline P8 ; **drain** des jobs legacy en vol. **Garder les deux branches, ne droper aucune colonne.**

### P10 — Backfill + suppression du legacy foot — 4-6 j · *dépend de : P9*
- **Backfill** des jobs foot historiques dans `inputs`, **avant tout drop** et **après épuisement** de la fenêtre de reprise.
- **NR1** : supprimer la branche `create()` foot. *(Après NR1 : plus de rollback metafield ; le kill-switch reste.)*
- **NR2** : supprimer la branche worker foot + `buildMasterPrompt` + câblage foot du juge + clés à plat. Garde : zéro job legacy non-terminal/reprenable. *(Après NR2 : plus de retour legacy.)*
- **Le code cesse d'utiliser** la table `custom_art_teams`, sa page d'admin et l'endpoint `/api/custom-art/teams` (plus aucune lecture/écriture ; tout se lit depuis les metafields). ⚠️ **On NE supprime PAS la table** : laissée en place, dormante — **le propriétaire la supprimera à la main plus tard** (décidé 22/07).
- Retrait des **3 lecteurs** des colonnes foot **en lockstep** avec l'arrêt d'écriture (sinon crash *colonne inconnue*).
- Colonnes `team_id/player_name/player_number` : cesser d'écrire ; **laissées en place** (historique/ré-impression). Le plan ne droppe rien ; **le propriétaire supprime table + colonnes à la main quand il le juge bon** (décidé 22/07).

---

## 3. Stratégie de bascule (le cœur du « ne rien casser »)

Les contre-épreuves ont **prouvé que « poser un metafield » n'est ni atomique ni réversible** telle quelle. Le cutover est donc **outillé** :

- **Kill-switch dur** (`STUDIO_GENERIC_DISABLE_PRODUCTS`, évalué en premier, sur app+cron) = rollback **immédiat**, indépendant du cache (Maps mémoire, TTL 5-10 min, aucun flush n'existe).
- **Discipline `version:1`** (jamais bumper `SUPPORTED_VERSION`) = un revert de build retombe en **legacy**, pas en 422.
- **Tolérance payload legacy + consent** = pas de 422 en masse pendant que le front en cache (4 h) est désaccordé du metafield (5 min).
- **Assembleur pur unique** + **golden-corpus** + **shadow-diff prod** = parité prouvée **au niveau du contrat** avant tout trafic réel.
- **Le produit foot réel reste sans recette jusqu'à P9** : tout le chantier est déployable sans risque, features OFF par défaut.

---

## 4. Definition of Done

1. **Code foot en dur supprimé** : plus de branche foot dans `create()`, plus de branche worker `inputs===null`, `buildMasterPrompt` supprimé, câblage foot du juge retiré, **aucune lecture** des colonnes foot dans les 3 lecteurs recensés.
2. **Un seul moteur** : famille ET foot routent par le chemin générique ; aucune branche par-produit ; le foot est un **profil de recette v2** ; honeypot actif sur le chemin générique.
3. **Tout se paramètre depuis la fiche produit** : images (maillots, pose) dans `studio.references` **par nom**, options+couleurs dans `studio.config`, notes+liaisons dans `studio.recipe`, et **les choix du client apparaissent sur la commande** (propriétés de commande déclarées via `studio.config`). **Le code n'utilise plus la table/admin/endpoint équipes** (laissés en place, dormants → suppression manuelle par le propriétaire). Changer un maillot / ajouter une équipe / créer un nouveau produit perso = édition des metafields, **zéro backend**.
4. **Foot rendu identique** : parité prouvée au niveau du contrat déterministe (assembleur pur unique, golden-corpus vert), shadow-diff zéro-écart, validation visuelle propriétaire, KPI non régressés.
5. **Rétro-compat famille intacte** : recette v1 jamais réécrite ; snapshots + golden schema + gate async verts ; `SUPPORTED_VERSION` jamais bumpé.
6. **Cutover réversible outillé** : kill-switch fonctionnel (app+cron), rollback metafield testé, tolérance payload legacy validée.
7. **Aval unifié** : mapper `OrderMailItem` centralisé (unique lecture des champs foot, garde anti-vide). Colonnes foot gardées **nullable** (historique), ni lues ni écrites.

---

## 5. Risques (tous les bloquants/majeurs ont une mitigation intégrée)

**Résolus dans le plan :**
- **[Bloquant → atténué par décision]** Cutover non-atomique. La moitié « consent » est levée par la décision `requireConsent=false` (le consentement ne peut plus causer de 422). Reste la forme du payload + le cache 4 h → tolérance payload legacy (P7) + front déployé & cache expiré **avant** le metafield (P9).
- **[Bloquant]** Rollback pas immédiat (pas de flush, TTL, 2 process) → kill-switch env-var (P0/P9).
- **[Majeur]** Revert-code piégé après bump de version → rester `version:1`, test build N-1 → legacy (P0).
- **[Majeur]** `validateGenericPayload` sync→async : `await` manquant = bypass sécurité famille → gate CI + tests de parité (P1).
- **[Majeur]** Honeypot absent du générique → porté (P1/P4), couvert par golden-corpus (P8).
- **[Majeur]** 3e lecteur des colonnes foot (Review) non énuméré → mapper centralisé + lockstep (P6/P10).
- **[Majeur]** Canal de déploiement du front probablement erroné → confirmer **avant** P5.
- **[Majeur]** Aval rewire des commandes payantes avant la preuve de parité → garde anti-vide + shadow-check (P6).

**Propres au modèle « tout-en-références » :**
- **Adressage par position fragile** → on adresse par **nom** (nom de fichier / clé), jamais par numéro d'ordre ; réordonner la liste ne casse rien (P0).
- **Migration d'images unique** (base → fichiers Shopify) : ~30 images à re-téléverser et nommer proprement ; risque = coquille de nom → golden-corpus + validation visuelle attrapent (P7/P8).
- **Cap de la liste relevé** (8 → ~40) : vérifier les limites Shopify et que seul le sous-ensemble utile est envoyé à l'IA (déjà le cas) (P0/P4).

**Résiduels à surveiller :**
- Parité non-déterministe : écart de rendu invisible dans le contrat mais visible à l'œil → **validation propriétaire obligatoire** (P8, couche 3).
- Defaulter par erreur un construct opt-in → régresse la famille → chaque bloc derrière présence, snapshots CI.
- Non-régression du juge : le rendre config-driven ne doit rien changer → bench de preuve d'identité (P3).
- Auto-deploy prod sur un chantier long → features OFF par défaut, foot réel sans recette jusqu'à P9, kill-switch en filet.
- Points de non-retour NR1/NR2 (+ drop colonnes déconseillé) → ne franchir qu'après soak + validation.

---

## 6. Décisions propriétaire — tranchées le 22/07/2026

1. **Consent** (P7) : **accord automatique** → `recipe.requireConsent=false` pour le foot (pas de case obligatoire ; le front envoie le consentement automatiquement, comme aujourd'hui). ⚠️ Garder visible la mention de confidentialité (« photo supprimée après la commande, aucun entraînement IA ») dans la page / la FAQ, puisqu'il n'y a plus de coche obligatoire.
2. **Canal de déploiement du front studio** (P5) : **un outil / une commande** (Shopify CLI ou intégration GitHub) qui envoie le thème — PAS l'éditeur en ligne, PAS `sync-prod.js`. Le versioning d'assets `?v=hash` se pilote via cet outil. *(Commande/outil exact à confirmer au moment de coder P5.)*
3. **Base de données (table équipes + colonnes foot)** (P10) : le code **cesse de les utiliser**, mais le plan **ne supprime rien** — la table `custom_art_teams` et les 3 colonnes foot sont laissées en place, dormantes ; **le propriétaire les supprimera à la main plus tard**.

**Reste une seule chose côté propriétaire :** le **feu vert sur l'ampleur** (~67-108 j-dev réels + 2-4 semaines calendaires de soak — une réimplémentation, pas un réglage).

---

## 7. Première preuve visuelle — 27/07/2026

**Produit de TEST caché** `gid://shopify/Product/10615502373211` (brouillon, tags `test-interne`,
`a-supprimer`), variante `53669651644763` « 30x40 cm / Sans cadre ». Recette + 30 maillots posés par
`node ace studio:post-foot-recipe … --execute`. **Le produit foot réel n'a PAS été touché.**

Trois créations lancées par la vraie porte client (`POST /api/custom-art/jobs`), photos du jeu de
référence `scripts/bench/golden-set/` :

| Équipe | Nom / n° | Verdict moteur |
|---|---|---|
| PSG | WALID 10 | prêt, meilleur score **7,65** — 2 candidats retenus sur 3 |
| FC Barcelone | LEO 19 | prêt, meilleur score **7,65** — 2 retenus sur 3 |
| Real Madrid | SOFIA 7 | prêt, meilleur score **7,80** — 3 retenus sur 3 |

**Ce que les journaux prouvent** (au-delà du « ça marche ») :
- `custom-art recipe chargée product=…10615502373211 model=gemini-3.1-flash-image candidates=3 refs=30`
  puis `job START (generic)` → le chemin **piloté par recette** a bien été emprunté, pas le legacy.
- Le juge tourne au **profil `foot.v1`** : format de journal foot (`bras=`, `mains=`, `suspicion=`,
  `text=`), donc les 2 passes + les 3 barrières dures sont bien celles du foot.
- Le juge **voit les maillots** (`seesReferences: true`) : un candidat PSG a été **recalé** avec le
  motif « bande Hechter réduite à une fine rayure » — impossible à formuler sans avoir la référence
  sous les yeux. Ce même candidat portait `WALİD` (I turc pointé) : le garde-fou anti-İ du prompt a
  donc bien été évalué et sanctionné.

**Défaut observé, NON imputable à l'unification :** sur le Real Madrid, un petit blason doré apparaît
sous le numéro, dans le dos — que le prompt interdit. Le prompt étant prouvé **identique au caractère
près** au prompt legacy (test golden, 60 combinaisons), le chemin actuel produit le même écart. À
traiter, le cas échéant, comme une amélioration de prompt — pas comme une régression de bascule.

### Décision propriétaire n°1 (consentement) : aucun travail requis — vérifié
Le plan prévoyait `recipe.requireConsent=false` pour éviter un 422. Vérification faite :
`assets/component-custom-art-studio.js` sur `origin/main` (déployé) ajoute **toujours**
`consent: '1'` au payload (`FOOT_FALLBACK_PAYLOAD_EXTRA`, ligne 67, utilisée ligne 2174), et la case
de consentement est **déjà obligatoire aujourd'hui** sur le chemin foot. Le contrôle de consentement
du chemin générique est donc un **non-événement** à la bascule. `requireConsent` n'existe pas côté
backend et **n'a pas besoin d'exister**. → tâche retirée du plan.

### Reste avant bascule du produit réel
1. **Étiquetage des créations** : sur le chemin recette, `playerName` / `playerNumber` / `teamId`
   remontent `null` dans `GET /jobs/:uuid` (colonnes foot non alimentées). `describeJob()` existe et
   est testé mais **n'est branché sur aucun des 5 lecteurs** — à faire avant la bascule, sinon
   l'admin et les commandes affichent des créations sans nom.
2. Validation à l'œil du propriétaire sur plus d'équipes / de visages.
3. Soak, puis pose de la recette sur `10528685621595` (= la bascule), kill-switch prêt.

---

## 8. Planche de validation + branchement du nommage — 27/07/2026 (suite)

### 8.1 Un outil pour juger sa propre recette
`node ace studio:render-samples <produit> <variante> --plan=… --photos=… [--execute]` : crée
plusieurs créations d'un coup, **hors des plafonds anti-abus** (2 essais anonymes/jour/IP, 5 avec
e-mail — ils protègent la boutique des inconnus, pas le propriétaire de sa propre recette). Le
**plafond de COÛT quotidien reste appliqué** et vérifié avant toute dépense. Aucun raccourci de
génération : même lecture de recette, même validation des champs, même normalisation de photo, puis
le worker habituel. Sessions marquées `outil-interne:studio:render-samples` (empreinte d'IP
qu'aucune session client ne peut porter).

### 8.2 Planche : 15/15 équipes vues, 15 visages différents
12 créations lancées (3 par l'API publique + 1 + 11 par la commande). **10 abouties, 2 en revue
manuelle.** Coût de la journée : 7,44 € (plafond 30 €).

Trois enseignements, tous vérifiés dans les journaux :
- **La chaîne de secours de la recette a servi pour de vrai.** Photo d'enfant de 3 ans (RC Lens) :
  `finishReason=IMAGE_SAFETY` DEUX FOIS sur `gemini-3.1-flash-image`, puis bascule automatique sur
  `gemini-3-pro-image` → `READY score=7,65`. Sans `providers.chain` dans la recette, cette commande
  échouait.
- **L'isolation du juge a encaissé un plantage** (`judge KO … juge enfant en échec code=1`) sans
  emporter la création : le job est sorti `READY score=8,15`.
- **Deux abandons instructifs, NON imputables à l'unification** (prompt prouvé identique) :
  *YANIS* → 5 candidats sur 6 ont floqué « YANİS » (I turc), tous recalés ; le garde-fou anti-İ du
  prompt ne suffit pas sur ce prénom. *MEI* → 6 candidats recalés sur la RESSEMBLANCE (7,0–7,3,
  juste sous la barre) pour un visage asiatique. Les deux méritent l'œil du propriétaire.

### 8.3 « 5 lecteurs » était faux : il y en a 43
Cartographie multi-angles (4 balayages indépendants + vérification adverse site par site + critique
de complétude). Résultat : **43 lectures à brancher**, et surtout **trois défauts réels** que le
recensement initial ne voyait pas.

1. **`describeJob` se disait DEUX FOIS.** Relevé sur de vraies créations : sur le chemin recette,
   `job.displayLabel` vaut « Paris Saint-Germain WALID 10 » (les champs joints). Comme chaque
   consommateur recompose le numéro et l'option, l'**e-mail CLIENT d'une commande PAYÉE** aurait dit
   « Paris Saint-Germain WALID 10 n°10 (Paris Saint-Germain) ». Corrigé : les trois morceaux sortent
   **séparés**, `displayName` est toujours NU, et l'invariant est tenu par le code (la branche du
   libellé brut qui joint les champs est refusée) — pas par chance.
2. **La relance client serait morte en SILENCE.** `whereNotNull('player_name')` ne matche plus rien
   sur le chemin recette → zéro e-mail « votre tableau vous attend », zéro erreur. Le critère est
   désormais ce que la création EST (un prénom ET un numéro, ce que raconte la copy).
3. **L'e-mail d'ATELIER perdait le maillot** : les six appels du chemin recette passent une équipe
   vide (elle n'est pas dans une colonne). Repli au point de rendu sur l'option choisie.

Un **trou préexistant** relevé au passage : `show()` ne renvoyait pas `teamName` (seul `last()` le
faisait) → une reprise par lien e-mail perdait déjà la propriété de commande « Équipe », chemin
recette ou non. Ajouté.

**Preuve en production** — `GET /api/custom-art/jobs/<uuid>` sur trois créations par recette :
`WALID / 10 / Paris Saint-Germain`, `CLARA / 8 / Olympique de Marseille`, `LOU / 5 / RC Lens`.
Ces trois champs valaient `null` avant le branchement ; ce sont eux que le thème recopie dans les
propriétés de la commande Shopify.

Revue adverse (5 angles + réfutation systématique) : une seule trouvaille a survécu (le point 3),
corrigée. Non-régression du chemin historique exigée et vérifiée site par site.
207 assertions vertes, `tsc` vert.

### 8.4 Reste avant la bascule du produit réel
- **Risque de bascule FRONT, à ne pas confondre avec celle du backend** : les propriétés de commande
  du foot viennent aujourd'hui de `state.playerName/playerNumber/teamName`, écrits **en dur** par
  l'écran foot historique (`bindNameStep`, sélecteur d'équipe). Le binder générique
  (`bindGenericInputs`) n'écrit que `state.fields[name]`, et `growth/studio-configs/foot.json` ne
  déclare **aucun `cartProperty`**. Basculer le BACKEND sur la recette ne casse rien (l'écran ne
  change pas) ; basculer l'ÉCRAN sur `studio.config` sans déclarer les `cartProperty` enverrait des
  commandes **sans prénom, sans numéro, sans équipe**. Le garde-fou de `validateStudioConfig` qui
  alerte là-dessus ne s'applique qu'aux configs SANS génération : il rate exactement ce cas.
- Validation à l'œil du propriétaire sur la planche ci-dessus.
- Soak, puis pose de la recette sur `10528685621595` (= la bascule), kill-switch prêt.

---

## 9. Voie de retour — TESTÉE en production le 28/07/2026

Un interrupteur d'urgence jamais actionné n'est pas un interrupteur. Celui-ci a été **essayé pour de
vrai sur le produit de TEST**, dans les deux sens, avant toute bascule.

**Résultat.** Interrupteur posé → la requête qui créait une création par recette tombe sur le
validateur historique (`422 — Choisis une équipe.`) et le journal dit
`custom-art routage: kill-switch actif product=… -> chemin legacy`. Interrupteur retiré → le journal
dit à nouveau `custom-art recipe chargée …` et la création repart. Fichier d'environnement
**identique au fichier d'avant le test** (`diff` vide).

**Interruption mesurée : ~10 secondes** (une réponse 502 le temps du redémarrage) — la même que
n'importe quel déploiement.

### Le mode d'emploi
```bash
ssh root@64.226.101.205
cd /opt/MyselfMonArt_Dashboard
cp .env .env.bak.avant-coupure                       # toujours une copie d'abord
echo 'STUDIO_GENERIC_DISABLE_PRODUCTS=10528685621595' >> .env

# ⚠️ PIÈGE : `docker compose up` échoue avec « invalid reference format » si la variable du nom
# d'image n'est pas exportée — elle vient d'un secret GitHub, elle n'est PAS dans .env.
# On la relit sur le conteneur en service :
IMG=$(docker inspect myselfmonart_dashboard-app-1 --format '{{.Config.Image}}')
export DOCKERHUB_USERNAME=${IMG%%/*}
docker compose up -d --no-deps app                   # recréer : un simple restart NE relit PAS .env
```
Pour revenir en arrière : `sed -i '/^STUDIO_GENERIC_DISABLE_PRODUCTS=/d' .env` puis les deux mêmes
dernières lignes.

**Contrôle** — la coupure est effective quand ceci apparaît :
```bash
docker logs --since 2m myselfmonart_dashboard-app-1 2>&1 | grep kill-switch
```

### Deux propriétés qui comptent le jour de l'incident
- **Effet immédiat** : l'interrupteur est évalué AVANT le chargement de la recette. On n'attend ni
  les 5 minutes du cache recette, ni Shopify.
- **Plusieurs produits d'un coup** : la liste est séparée par des virgules, et accepte aussi bien
  l'identifiant numérique que le GID complet.

### Ce qui reste, et ce qui n'est plus un risque
La bascule du produit réel (`10528685621595`) est désormais **réversible en une minute et
prouvée**. Il ne reste plus qu'une décision du propriétaire : la déclencher.

---

## 10. BASCULE FAITE — 28/07/2026, 08:17 UTC

`node ace studio:post-foot-recipe gid://shopify/Product/10528685621595 --execute` →
`studio.references` (30 maillots) puis `studio.recipe` posés sur le **produit réel**. Le poster foot
« joueur de légende » ne passe plus par le chemin codé en dur.

### Contrôles avant bascule (tous passés)
| Contrôle | Résultat |
|---|---|
| Recette/références absentes avant | ✅ état de départ confirmé |
| Écran RÉELLEMENT servi aux clients envoie `teamSlug` | ✅ vérifié dans l'asset minifié en ligne |
| Consentement envoyé automatiquement | ✅ présent dans l'asset en ligne |
| Les 15 équipes proposées existent toutes dans la recette | ✅ 15/15, aucun écart |
| Formats 75x100 / 90x120 | ✅ **déjà** en erreur AVANT la bascule (voir ci-dessous) |
| Voie de retour | ✅ essayée en production (§9) |

⚠️ **PIÈGE DE MÉTHODE ÉVITÉ DE JUSTESSE.** La première vérification de l'écran en ligne a répondu
« NON, `teamSlug` absent » — et c'était FAUX : l'asset servi est **minifié**, je cherchais la chaîne
non minifiée `fd.append('teamSlug'` (apostrophes simples) alors que le fichier livré contient
`fd.append("teamSlug",…)`. Sur la foi de ce faux négatif, on aurait pu croire la bascule impossible.
**Toujours inspecter les occurrences réelles, jamais se fier à une recherche de chaîne exacte sur un
fichier minifié.**

### Découverte annexe, INDÉPENDANTE de ce chantier
Le produit affiche **4 formats** (30x40, 60x80, 75x100, 90x120) mais toute la chaîne n'en gère que
**2** : le validateur (`schema.enum(['30x40','60x80'])`), le type `CustomArtFormat` et les gabarits
d'impression `PRINT_SPECS`. Vérifié empiriquement AVANT la bascule : une création en 75x100 renvoyait
déjà `422 — Variante inconnue`. La bascule ne change donc rien, **mais deux des quatre formats vendus
sont inutilisables dans le studio**. À traiter séparément.

### Vérification après bascule
- Cache recette : le routage a basculé **~5 min** après la pose, comme annoncé. Pendant cet
  intervalle, les créations sont parties sur l'ancien chemin — sans incident, les deux coexistent.
- Requête à la forme EXACTE d'un client (`teamId` + `teamSlug` + prénom + numéro + photo, variante
  30x40 sans cadre) : elle traverse consentement → validation des champs par la recette → photo, et
  n'est arrêtée que par le plafond d'essais quotidien. **Le parcours client est validé de bout en
  bout, à coût nul.**
- Génération réelle sur le produit réel : `455c48ae` → maillot Équipe de France, « LUCAS » au-dessus
  du « 7 » en typographie dorée, aucun blason dans le dos, enfant préservé.
- Étiquetage de commande : `LUCAS / 7 / Équipe de France / 30x40 / none`.
- Journaux depuis la bascule : **aucune erreur imputable**. (Un `judge KO` figure dans la fenêtre : il
  concerne le produit de TEST, et le job est sorti `ready` — l'isolation du juge a fait son travail.)

### Retour arrière, si besoin
Mode d'emploi complet au §9. En une ligne :
`echo 'STUDIO_GENERIC_DISABLE_PRODUCTS=10528685621595' >> .env` puis recréer le conteneur `app`.
Effet immédiat, ~10 s d'interruption.
