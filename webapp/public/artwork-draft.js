/* ===== MyselfMonArt Publisher — la toile et son poster sur la nouvelle fiche (fiche produit 3D, tickets 09, 14, 16 et 18) =====
   Le seul chemin pour une toile ou un poster à créer. Ni mockups ni moteur du PC : chaque produit
   n'a qu'une image, l'œuvre à plat. Une image donne la toile et son poster (une image carrée, la
   toile seule). Claude écrit leurs textes, Walid vérifie tout sur un écran, décoche ce qu'il ne veut
   pas, et un clic les met en vente. L'autre choix au-dessus de l'image, la tapisserie, garde les
   mockups (décision de Walid du 17/11/2026 : toiles et posters neufs sur la fiche 3D seulement).

   Ticket 16 : une image de moins de 4 000 px est d'abord agrandie pour le site, puis comparée à
   l'originale. Un échec ou un écart se disent ici, et Walid choisit : rien ne se crée sans lui.

   Chargé après app.js, même scope global (comme personalized.js) ; app.js ne porte que les points
   de branchement : refreshAction, maybeRunFavorites et le clic sur le bouton d'action. */
;(function () {
  'use strict'

  const LONG_WAIT_MS = 4 * 60 * 1000
  const KINDS = ['painting', 'poster']
  // Les mots de chaque produit, à un seul endroit.
  const WORDS = {
    painting: { name: 'Toile', the: 'la toile', link: 'Voir la toile dans l’admin' },
    poster: { name: 'Poster', the: 'le poster', link: 'Voir le poster dans l’admin' },
  }
  // Une image donne la toile et son poster : les deux sont cochés au départ.
  const EVERY_PRODUCT = Object.freeze({ painting: true, poster: true })

  const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1)

  function elapsedLabel(ms) {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds} s`
    return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`
  }

  function imageStep(upscale) {
    if (!upscale) return { state: 'ok', text: 'Assez grande, gardée telle quelle' }
    switch (upscale.state) {
      case 'working':
        return { state: 'wait', text: 'Votre image est agrandie pour le site, environ 30 secondes.' }
      case 'failed':
        return { state: 'err', text: "N'a pas pu être agrandie" }
      case 'checking':
        return { state: 'wait', text: 'Agrandie. Comparaison avec votre image en cours…' }
      case 'doubtful':
        return { state: 'warn', text: 'Agrandie, mais à vérifier' }
      case 'kept':
        return { state: 'ok', text: 'Agrandie, gardée après vérification' }
      case 'original':
        return { state: 'ok', text: "Votre image d'origine, telle quelle" }
      default:
        return { state: 'ok', text: 'Agrandie pour le site, fidèle à la vôtre' }
    }
  }

  function textsStep(texts, ratio) {
    if (texts === 'done') return { state: 'ok', text: 'Prêts' }
    if (texts === 'failed') return { state: 'err', text: "N'ont pas pu être écrits" }
    return {
      state: 'wait',
      text:
        ratio === 'square'
          ? "Claude écrit le titre, la description et le texte de l'image de la toile…"
          : 'Claude écrit les textes de la toile, puis ceux de son poster…',
    }
  }

  const FAILED_TITLES = {
    upscale: "L'image n'a pas pu être agrandie",
    texts: "Les textes n'ont pas pu être écrits",
  }

  const UPSCALE_REASONS = {
    shapes: 'des formes ont changé',
    colors: 'les couleurs ont bougé',
    details: 'des détails ont été ajoutés',
  }

  /** « a, b et c » */
  function inWords(items) {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items[0]
  }

  function upscaleAlert({ reasons }) {
    const seen = reasons.length
      ? `L'agrandissement s'écarte de votre image : ${inWords(reasons.map((reason) => UPSCALE_REASONS[reason]))}.`
      : "La comparaison automatique avec votre image n'a pas pu se faire."
    return `${seen} Comparez les deux versions ci-dessous, puis choisissez. Rien ne sera créé sans votre accord.`
  }

  function upscaleFailure({ noCredit }) {
    return noCredit
      ? "Il n'y a plus de crédit pour agrandir les images. Rien n'est perdu : votre image est gardée telle quelle. Continuez avec elle, ou réessayez une fois le crédit rechargé."
      : "Rien n'est perdu : votre image est gardée telle quelle. Vous pouvez réessayer, ou continuer avec elle."
  }

  function missingPoster({ painting, posterMissing }) {
    return posterMissing === 'square'
      ? 'Pas de poster pour une image carrée : la boutique ne vend pas de poster carré.'
      : `Pas de poster : « ${painting.collection.title} » n'a pas encore de collection poster. ` +
          "Créez-la sur la boutique, ou demandez à Claude de l'ajouter à la table des correspondances."
  }

  /** Les produits que l'image donne, cochés ou non : un poster impossible ne se coche jamais. */
  function reviewProducts(review, chosen) {
    return KINDS.map((kind) => {
      const product = review[kind]
      return {
        kind,
        name: WORDS[kind].name,
        available: !!product,
        checked: !!product && !!chosen[kind],
        collection: product ? product.collection.title : null,
        note: product ? null : missingPoster(review),
      }
    })
  }

  /** Ce qui partira d'un clic : les produits possibles et cochés. */
  const keptKinds = (products) =>
    products.filter(({ available, checked }) => available && checked).map(({ kind }) => kind)

  /** Le bouton dit ce qui va partir, et rien ne part sans une case cochée. */
  function createButton(products) {
    const kept = keptKinds(products)
    const label = kept.length ? `Publier ${kept.map((kind) => WORDS[kind].the).join(' et ')}` : 'Publier'
    return { label, disabled: kept.length === 0 }
  }

  function creationFailure(leftovers) {
    if (leftovers.length > 1) {
      return "Des produits incomplets sont restés sur la boutique : ils seront retirés au prochain essai. Sinon, supprimez-les dans l'admin."
    }
    if (leftovers.length) {
      return "Un produit incomplet est resté sur la boutique : il sera retiré au prochain essai. Sinon, supprimez-le dans l'admin."
    }
    return "Rien n'est resté sur la boutique. Vous pouvez réessayer."
  }

  function publishedNote(products) {
    if (products.length > 1) {
      return "La toile et le poster sont en ligne, reliés l'un à l'autre, avec leurs tailles et leurs options."
    }
    const kind = products[0] ? products[0].kind : 'painting'
    return `${capitalized(WORDS[kind].the)} est en ligne, avec ses tailles et ses options.`
  }

  /**
   * Ce que montre l'écran pour un état de la préparation. `chosen` : les cases que Walid a laissées
   * cochées. Sans DOM : tests/golden/artwork-draft-screen.js.
   */
  function draftScreen(view, elapsedMs, { offline = false, chosen = EVERY_PRODUCT } = {}) {
    const screen = {
      title: '',
      busy: false,
      steps: [],
      note: '',
      problem: null,
      review: false,
      compare: false,
      products: [],
      create: null,
      links: [],
      buttons: [],
    }
    const upscale = view.upscale || null
    const steps = () => [
      { name: 'Image', ...imageStep(upscale) },
      { name: 'Textes', ...textsStep(view.texts, view.ratio) },
    ]
    // Les deux images côte à côte, tant que c'est l'agrandie qui part sur la fiche.
    const compare = !!(upscale && upscale.upscaled && upscale.state !== 'original')

    switch (view.stage) {
      case 'sending':
        return { ...screen, title: 'Préparation de la fiche', busy: true, note: "Envoi de l'image…" }
      case 'unsent':
        return {
          ...screen,
          title: "L'image n'est pas partie",
          problem: `${view.message} Rien n'a été créé.`,
          buttons: ['retry', 'close'],
        }
      case 'expired':
        return {
          ...screen,
          title: 'Session expirée',
          problem: 'Rechargez la page pour vous reconnecter.',
          buttons: ['close'],
        }
      case 'failed':
        if (view.problem === 'upscale') {
          return {
            ...screen,
            title: FAILED_TITLES.upscale,
            steps: steps(),
            problem: upscaleFailure(upscale),
            buttons: ['original', 'retry', 'cancel'],
          }
        }
        return {
          ...screen,
          title: FAILED_TITLES[view.problem] || FAILED_TITLES.texts,
          steps: steps(),
          problem: "Rien n'a été créé. Vous pouvez réessayer.",
          buttons: ['retry', 'cancel'],
        }
      case 'deciding':
        return {
          ...screen,
          title: "À vérifier : l'image agrandie",
          problem: upscaleAlert(upscale),
          review: true,
          compare,
          products: reviewProducts(view.review, chosen),
          buttons: ['keep', 'original', 'cancel'],
        }
      case 'ready': {
        const failed = view.problem === 'creation'
        const leftovers = view.leftoverUrls || []
        const products = reviewProducts(view.review, chosen)
        return {
          ...screen,
          title: failed ? "La publication n'a pas pu se faire" : 'À vérifier avant de publier',
          problem: failed ? creationFailure(leftovers) : null,
          review: true,
          compare,
          products,
          create: createButton(products),
          links: leftovers.map((url) => ({ label: 'Voir le produit resté dans l’admin', url })),
          buttons: ['create', 'cancel'],
        }
      }
      case 'creating':
        return {
          ...screen,
          title: 'Publication…',
          busy: true,
          note:
            "Shopify reçoit l'image, puis chaque produit prend ses tailles et ses options avant d'être mis en vente : " +
            `une à deux minutes en général. Déjà ${elapsedLabel(elapsedMs)}.`,
        }
      case 'created': {
        const products = view.products || []
        return {
          ...screen,
          title: 'Publié sur la boutique ✓',
          note: publishedNote(products),
          links: products.map(({ kind, adminUrl }) => ({ label: WORDS[kind].link, url: adminUrl })),
          buttons: ['close'],
        }
      }
      default: {
        const slow = elapsedMs >= LONG_WAIT_MS
        const elapsed = `Déjà ${elapsedLabel(elapsedMs)}.`
        return {
          ...screen,
          title: 'Préparation de la fiche',
          busy: true,
          steps: steps(),
          note: offline
            ? 'Connexion interrompue, nouvel essai en cours… Votre fiche continue de se préparer.'
            : slow
              ? `${elapsed} C'est plus long que d'habitude. Vous pouvez continuer à attendre, ou annuler.`
              : `${elapsed} Rien n'est bloqué, vous pouvez attendre ici.`,
          buttons: ['cancel'],
        }
      }
    }
  }

  if (typeof document === 'undefined') {
    module.exports = { draftScreen }
    return
  }

  const POLL_MS = 2000
  const SEND_TIMEOUT_MS = 180000 // une grande image sur une connexion de téléphone
  const CALL_TIMEOUT_MS = 20000
  const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

  const overlay = $('#draftOverlay')
  const review = $('#draftReview')
  const compare = $('#draftCompare')
  const links = $('#draftLinks')
  const buttons = {
    create: $('#draftCreate'),
    keep: $('#draftKeep'),
    original: $('#draftOriginal'),
    retry: $('#draftRetry'),
    cancel: $('#draftCancel'),
    close: $('#draftClose'),
  }

  // Ce chemin est choisi : en création, sauf pour une tapisserie. Jamais en reimage ni pour un poster
  // personnalisé, qui gardent leur chemin.
  let active = MODE === 'create'
  // La préparation à l'écran : { id, image, view, startedAt, offline, chosen }
  let run = null
  let createdImage = null // l'image des derniers produits créés : le bouton ne la reprend pas deux fois
  let ticker = null
  // Ce qui est déjà à l'écran : refait seulement s'il change, pour que le focus n'y saute pas chaque seconde.
  let shownReview = ''
  let shownLinks = ''
  // Un ordre part : ses boutons restent grisés jusqu'à la réponse, même quand l'écran se repeint.
  let sending = false

  const isWorking = ({ stage }) => stage === 'preparing' || stage === 'creating'
  const isExpired = (res) => res.status === 401 || res.redirected
  const screenOf = (current) =>
    draftScreen(current.view, Date.now() - current.startedAt, {
      offline: current.offline,
      chosen: current.chosen,
    })

  /* ---------- Affichage ---------- */

  function paintSteps(steps) {
    const list = $('#draftSteps')
    list.innerHTML = ''
    for (const { name, text, state: stepState } of steps) {
      const item = document.createElement('li')
      item.className = `draft-step ${stepState}`
      const label = document.createElement('b')
      label.textContent = name
      item.append(label, ` ${text}`)
      list.append(item)
    }
  }

  function descriptionBlocks(html) {
    const { body } = new DOMParser().parseFromString(html, 'text/html')
    return [...body.children].map((node) => {
      const block = document.createElement(/^H\d$/.test(node.tagName) ? 'h4' : 'p')
      block.textContent = node.textContent
      return block
    })
  }

  /** L'œuvre à plat : la seule image de chaque produit. */
  function paintArtwork({ painting }) {
    const zoom = $('#draftArtwork button')
    zoom.onclick = () => openLightbox(painting.image)
    const image = $('#draftArtwork img')
    image.src = painting.image
    image.alt = painting.media.alt
  }

  function paintTexts(list, { title, shortTitle, descriptionHtml, metaTitle, metaDescription, tags, media }) {
    const add = (label, ...content) => {
      const term = document.createElement('dt')
      term.textContent = label
      const value = document.createElement('dd')
      value.append(...content)
      list.append(term, value)
    }
    add('Titre', title)
    add('Titre court', shortTitle)
    add('Description', ...descriptionBlocks(descriptionHtml))
    add('Titre pour Google', metaTitle)
    add('Description pour Google', metaDescription)
    add('Mots-clés', tags.join(', '))
    add("Texte de l'image", media.alt)
    add('Nom du fichier', media.filename)
  }

  /** Un bloc par produit, avec sa case : décochée, il ne sera pas créé. */
  function paintProducts(draftReview, products) {
    const blocks = $('#draftProducts')
    blocks.innerHTML = ''
    for (const { kind, name, available, checked, collection, note } of products) {
      const block = document.createElement('section')
      block.className = 'draft-product'
      const head = document.createElement('label')
      head.className = 'draft-product-head'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = checked
      box.disabled = !available
      box.addEventListener('change', () => {
        run.chosen[kind] = box.checked
        paint()
      })
      const title = document.createElement('b')
      title.textContent = name
      head.append(box, title)
      if (collection) {
        const where = document.createElement('span')
        where.textContent = collection
        // L'espace sépare les deux mots pour un lecteur d'écran ; à l'œil, c'est l'écart de la ligne.
        head.append(' ', where)
      }
      block.append(head)
      if (note) {
        const missing = document.createElement('p')
        missing.className = 'draft-note'
        missing.textContent = note
        block.append(missing)
      } else {
        const list = document.createElement('dl')
        list.className = 'draft-texts'
        paintTexts(list, draftReview[kind])
        block.append(list)
      }
      blocks.append(block)
    }
  }

  /** Un carré de 15 % de la largeur, centré sur la zone qui a le plus changé et gardé dans l'image. */
  function closeUp({ url, width, height }, zone) {
    const across = 0.15
    const down = (across * width) / height
    const left = Math.min(1 - across, Math.max(0, zone.x + zone.width / 2 - across / 2))
    const top = Math.min(1 - down, Math.max(0, zone.y + zone.height / 2 - down / 2))
    return {
      backgroundImage: `url("${url}")`,
      backgroundSize: `${100 / across}% auto`,
      backgroundPosition: `${(left / (1 - across)) * 100}% ${(top / (1 - down)) * 100}%`,
    }
  }

  /** Votre image et l'image agrandie côte à côte, chacune avec son gros plan au même endroit. */
  function paintCompare({ source, upscaled, zone }) {
    const grid = $('#draftCompareGrid')
    grid.innerHTML = ''
    for (const [label, image] of [
      ['Votre image', source],
      ['Agrandie pour le site', upscaled],
    ]) {
      const figure = document.createElement('figure')
      figure.className = 'draft-photo'
      const zoom = document.createElement('button')
      zoom.type = 'button'
      zoom.title = 'Agrandir'
      zoom.addEventListener('click', () => openLightbox(image.url))
      const picture = document.createElement('img')
      picture.src = image.url
      picture.alt = label
      zoom.append(picture)
      figure.append(zoom)
      if (zone) {
        const detail = document.createElement('div')
        detail.className = 'draft-closeup'
        detail.setAttribute('role', 'img')
        detail.setAttribute('aria-label', `${label}, gros plan`)
        Object.assign(detail.style, closeUp(image, zone))
        figure.append(detail)
      }
      const caption = document.createElement('figcaption')
      const title = document.createElement('b')
      title.textContent = label
      caption.append(title, `${image.width} × ${image.height} px`)
      figure.append(caption)
      grid.append(figure)
    }
    $('#draftCompareZone').classList.toggle('hidden', !zone)
    $('#draftSourceLink').href = source.url
  }

  function paintLinks(screenLinks) {
    const key = JSON.stringify(screenLinks)
    if (key === shownLinks) return
    shownLinks = key
    links.innerHTML = ''
    for (const { label, url } of screenLinks) {
      const link = document.createElement('a')
      link.className = 'primary-btn'
      link.target = '_blank'
      link.rel = 'noopener'
      link.href = url
      link.textContent = label
      links.append(link)
    }
  }

  function paint() {
    const { view } = run
    const screen = screenOf(run)
    $('#draftTitle').textContent = screen.title
    $('#draftSpinner').classList.toggle('hidden', !screen.busy)
    paintSteps(screen.steps)
    const note = $('#draftNote')
    note.textContent = screen.note
    note.classList.toggle('hidden', !screen.note)
    const problem = $('#draftProblem')
    problem.textContent = screen.problem || ''
    problem.classList.toggle('hidden', !screen.problem)
    // Refait quand ce qu'il montre change : son image d'origine gardée, Walid la voit aussitôt.
    const reviewKey = screen.review ? JSON.stringify([view.review, screen.compare]) : ''
    if (reviewKey && reviewKey !== shownReview) {
      paintArtwork(view.review)
      paintProducts(view.review, screen.products)
      if (screen.compare) paintCompare(view.upscale)
    }
    shownReview = reviewKey
    compare.classList.toggle('hidden', !screen.compare)
    review.classList.toggle('hidden', !screen.review)
    paintLinks(screen.links)
    for (const [name, button] of Object.entries(buttons)) {
      button.classList.toggle('hidden', !screen.buttons.includes(name))
    }
    if (screen.create) {
      buttons.create.textContent = screen.create.label
      buttons.create.disabled = sending || screen.create.disabled
    }
  }

  function show() {
    overlay.classList.remove('hidden')
    document.body.classList.add('draft-open')
    review.classList.add('hidden')
    shownReview = ''
    shownLinks = ''
    clearInterval(ticker)
    // Chaque seconde, même sans nouvelle du serveur : l'écran ne doit jamais sembler figé.
    ticker = setInterval(paint, 1000)
    paint()
    $('.draft-card').focus()
  }

  function hide() {
    clearInterval(ticker)
    run = null
    overlay.classList.add('hidden')
    document.body.classList.remove('draft-open')
    refreshAction()
  }

  /* ---------- Échanges avec le backend ---------- */

  async function follow(current) {
    while (run === current) {
      try {
        const { res, data } = await fetchJsonT(
          `${API}/api/artwork-drafts/${current.id}`,
          { headers: HEADERS },
          CALL_TIMEOUT_MS
        )
        if (run !== current) return
        if (isExpired(res)) return settle(current, { stage: 'expired' })
        if (!res.ok || !data.success) throw new Error('état illisible')
        current.offline = false
        if (data.data.stage === 'cancelled') return hide()
        settle(current, data.data)
        if (!isWorking(data.data)) return
      } catch {
        if (run !== current) return
        current.offline = true
        paint()
      }
      await sleep(POLL_MS)
    }
  }

  function settle(current, view) {
    current.view = view
    if (view.stage === 'created') createdImage = current.image
    paint()
  }

  async function start() {
    const image = state.imageDataUrl
    const current = {
      id: null,
      image,
      view: { stage: 'sending' },
      startedAt: Date.now(),
      offline: false,
      chosen: { ...EVERY_PRODUCT },
    }
    run = current
    show()
    try {
      const { res, data } = await fetchJsonT(
        `${API}/api/artwork-drafts`,
        {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({
            image,
            ratio: state.orientation,
            parentCollection: { id: state.collection.id, title: state.collection.title },
          }),
        },
        SEND_TIMEOUT_MS
      )
      if (isExpired(res)) return settle(current, { stage: 'expired' })
      if (!res.ok || !data.success) {
        return settle(current, {
          stage: 'unsent',
          message: data.message || "L'image n'a pas pu être envoyée.",
        })
      }
      current.id = data.data.id
      settle(current, data.data)
      follow(current)
    } catch (error) {
      settle(current, {
        stage: 'unsent',
        message:
          error.name === 'AbortError'
            ? "L'envoi a pris trop de temps."
            : "La connexion a été coupée pendant l'envoi.",
      })
    }
  }

  /** Un ordre au backend. Sa réponse est le nouvel état, et le suivi reprend s'il y a du travail. */
  async function send(current, action, body) {
    const { res, data } = await fetchJsonT(
      `${API}/api/artwork-drafts/${current.id}/${action}`,
      { method: 'POST', headers: HEADERS, ...(body ? { body: JSON.stringify(body) } : {}) },
      CALL_TIMEOUT_MS
    )
    if (isExpired(res)) {
      settle(current, { stage: 'expired' })
      return current.view
    }
    if (!res.ok || !data.success) throw new Error('ordre refusé')
    if (data.data.stage === 'cancelled') return data.data
    settle(current, data.data)
    if (isWorking(data.data)) follow(current)
    return data.data
  }

  async function order(action, body) {
    const current = run
    sending = true
    for (const button of Object.values(buttons)) button.disabled = true
    current.startedAt = Date.now()
    try {
      await send(current, action, body)
    } catch {
      toast('La connexion a été coupée. Réessayez dans un instant.', 'err')
    } finally {
      sending = false
      for (const button of Object.values(buttons)) button.disabled = false
      // Le bouton de publication reste grisé sans case cochée.
      if (run === current) paint()
    }
  }

  /** Les produits que Walid a laissés cochés, parmi ceux que l'image donne. */
  const chosenProducts = () => keptKinds(reviewProducts(run.view.review, run.chosen))

  /**
   * Une annulation qui ne prend pas (trop tard, ou un produit resté à retirer) laisse l'écran ouvert,
   * sur le nouvel état. Sans réponse, il se ferme : rien ne se crée sans le clic de publication.
   */
  async function cancel() {
    const current = run
    if (current.id) {
      try {
        const { stage } = await send(current, 'cancel')
        if (stage !== 'cancelled') return
      } catch {
        // Voir au-dessus.
      }
    }
    hide()
  }

  /* ---------- Choix du produit : la toile et son poster, ou une tapisserie ---------- */

  /** Montre les cartes du produit choisi : la nouvelle fiche, ou les mockups de la tapisserie. */
  function applyPath() {
    $$('#draftChoice .seg-btn').forEach((button) => {
      button.classList.toggle('active', (button.dataset.path === 'draft') === active)
    })
    $('#draftChoiceNote').classList.toggle('hidden', !active)
    $('#draftCard').classList.toggle('hidden', !active)
    for (const id of ['#mockupsCard', '#resultsCard']) $(id).classList.toggle('hidden', active)
    if (!active) $('#publishBtn').textContent = "Publier l'œuvre"
  }

  function choose(next) {
    if (next === active) return
    if (next) {
      if (
        state.results.length &&
        !confirm('Passer à la toile et son poster va effacer les rendus de la tapisserie. Continuer ?')
      )
        return
      clearResults() // arrête aussi un lot de favoris en cours : ni Photopea ni Gemini sur ce chemin
    }
    active = next
    // Le type suit, par le sélecteur caché de app.js : il vide la collection, recharge collections et
    // mockups, puis lance les favoris d'une tapisserie. La nouvelle fiche part de la collection de la
    // toile ; le poster prend celle des posters de son thème.
    $(`#productType .seg-btn[data-type="${active ? 'toile' : 'tapisserie'}"]`).click()
    applyPath()
    refreshAction()
  }

  function refreshDraftAction() {
    const info = $('#actionInfo')
    const button = $('#publishBtn')
    button.textContent = 'Préparer la fiche'
    if (state.needsResize) {
      info.textContent = "⚠️ Retaille l'image au bon format pour continuer"
      button.disabled = true
      return
    }
    if (state.imageDataUrl && state.imageDataUrl === createdImage) {
      info.textContent = 'Déjà publiée pour cette image'
      button.disabled = true
      return
    }
    const parts = []
    if (state.orientation) parts.push(labelOri(state.orientation))
    if (state.collection) parts.push(state.collection.title)
    parts.push(state.orientation === 'square' ? 'Toile sur la nouvelle fiche' : 'Toile et poster sur la nouvelle fiche')
    info.textContent = parts.join(' · ')
    button.disabled = !(state.imageDataUrl && state.collection)
  }

  buttons.create.addEventListener('click', () => order('create', { products: chosenProducts() }))
  buttons.keep.addEventListener('click', () => order('keep-upscaled'))
  buttons.original.addEventListener('click', () => order('use-original'))
  buttons.retry.addEventListener('click', () => (run.id ? order('retry') : start()))
  buttons.cancel.addEventListener('click', cancel)
  buttons.close.addEventListener('click', hide)
  $$('#draftChoice .seg-btn').forEach((button) => {
    button.addEventListener('click', () => choose(button.dataset.path === 'draft'))
  })

  window.ArtworkDraftMode = {
    active: () => active,
    start,
    /** true : ce chemin a pris la barre d'action. */
    refreshAction() {
      if (active) refreshDraftAction()
      return active
    },
  }

  if (MODE === 'create') {
    // En création, le produit se choisit au-dessus de l'image : le sélecteur Toile | Poster |
    // Tapisserie reste caché, il ne sert qu'au mode reimage et au poster personnalisé.
    $('#draftChoice').classList.remove('hidden')
    $('#productType').classList.add('hidden')
    applyPath()
    refreshAction()
  }
})()
