/* ===== MyselfMonArt Publisher — une toile sur la nouvelle fiche (fiche produit 3D, ticket 09) =====
   Second chemin, à choisir en haut de la page. Il n'utilise ni les mockups ni le moteur du PC : le
   backend rend les photos pendant que Claude écrit les textes, Walid vérifie tout sur un écran, et
   un clic crée le brouillon. Le chemin des mockups reste le défaut et ne change pas.

   Chargé après app.js, même scope global (comme personalized.js) ; app.js ne porte que les points
   de branchement : refreshAction, maybeRunFavorites et le clic sur le bouton d'action. */
;(function () {
  'use strict'

  const LONG_WAIT_MS = 4 * 60 * 1000

  function elapsedLabel(ms) {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds} s`
    return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`
  }

  function photosStep({ status, studioBusy, ahead, attempts }) {
    if (status === 'done') return { state: 'ok', text: 'Prêtes' }
    if (status === 'failed') return { state: 'err', text: "N'ont pas pu être préparées" }
    if (status === 'rendering') {
      return {
        state: 'wait',
        text: attempts
          ? 'Nouvel essai en cours, environ 45 secondes…'
          : 'Prise de vue en cours, environ 45 secondes…',
      }
    }
    if (studioBusy) {
      return {
        state: 'wait',
        text: "En pause : une cliente crée son poster personnalisé, elle passe d'abord. Les photos reprennent toutes seules.",
      }
    }
    if (ahead === 1) return { state: 'wait', text: 'Une autre œuvre passe avant, puis ce sera la vôtre.' }
    if (ahead > 1) return { state: 'wait', text: `${ahead} autres œuvres passent avant, puis ce sera la vôtre.` }
    return { state: 'wait', text: 'Démarrage dans quelques secondes…' }
  }

  function textsStep(texts) {
    if (texts === 'done') return { state: 'ok', text: 'Prêts' }
    if (texts === 'failed') return { state: 'err', text: "N'ont pas pu être écrits" }
    return { state: 'wait', text: 'Claude écrit le titre, la description et les textes des images…' }
  }

  const FAILED_TITLES = {
    photos: "Les photos n'ont pas pu être préparées",
    texts: "Les textes n'ont pas pu être écrits",
  }

  /** Ce que montre l'écran pour un état du brouillon. Sans DOM : tests/golden/artwork-draft-screen.js. */
  function draftScreen(view, elapsedMs, { offline = false } = {}) {
    const screen = { title: '', busy: false, steps: [], note: '', problem: null, review: false, buttons: [] }
    const steps = () => [
      { name: 'Photos', ...photosStep(view.photos) },
      { name: 'Textes', ...textsStep(view.texts) },
    ]

    switch (view.stage) {
      case 'sending':
        return { ...screen, title: 'Préparation de la toile', busy: true, note: "Envoi de l'image…" }
      case 'unsent':
        return {
          ...screen,
          title: "L'image n'est pas partie",
          problem: `${view.message} Rien n'a été créé.`,
          buttons: ['retry', 'mockups', 'close'],
        }
      case 'expired':
        return {
          ...screen,
          title: 'Session expirée',
          problem: 'Rechargez la page pour vous reconnecter.',
          buttons: ['close'],
        }
      case 'failed':
        return {
          ...screen,
          title: FAILED_TITLES[view.problem],
          steps: steps(),
          problem: "Rien n'a été créé. Vous pouvez réessayer, ou passer par les mockups avec la même image.",
          buttons: ['retry', 'mockups', 'cancel'],
        }
      case 'ready': {
        const created = view.problem === 'creation'
        return {
          ...screen,
          title: created ? "Le brouillon n'a pas pu être créé" : 'À vérifier avant de créer le brouillon',
          problem: !created
            ? null
            : view.leftoverUrl
              ? "Un brouillon incomplet est resté sur la boutique : il sera retiré au prochain essai. Sinon, supprimez-le dans l'admin."
              : "Rien n'est resté sur la boutique. Vous pouvez réessayer, ou passer par les mockups.",
          review: true,
          buttons: !created
            ? ['create', 'cancel']
            : view.leftoverUrl
              ? ['create', 'link', 'mockups', 'cancel']
              : ['create', 'mockups', 'cancel'],
        }
      }
      case 'creating':
        return {
          ...screen,
          title: 'Création du brouillon…',
          busy: true,
          note: `Shopify reçoit les photos, moins d'une minute en général. Déjà ${elapsedLabel(elapsedMs)}.`,
        }
      case 'created':
        return {
          ...screen,
          title: 'Brouillon créé ✓',
          note:
            "Il n'est pas encore en ligne. Pour le mettre en vente : ouvrez-le dans l'admin, passez-le en Actif et cochez Boutique en ligne. " +
            "Ses tailles et ses options arrivent d'elles-mêmes d'ici quelques minutes.",
          buttons: ['link', 'close'],
        }
      default: {
        const slow = elapsedMs >= LONG_WAIT_MS
        const elapsed = `Déjà ${elapsedLabel(elapsedMs)}.`
        return {
          ...screen,
          title: 'Préparation de la toile',
          busy: true,
          steps: steps(),
          note: offline
            ? 'Connexion interrompue, nouvel essai en cours… Votre toile continue de se préparer.'
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
  const PHOTO_LABELS = {
    'face': 'De face',
    'oeuvre': "L'image à plat",
    'trois-quarts': 'De trois-quarts',
    'matiere': 'La matière',
    'coin': 'Le coin du cadre',
  }

  const overlay = $('#draftOverlay')
  const review = $('#draftReview')
  const buttons = {
    create: $('#draftCreate'),
    retry: $('#draftRetry'),
    link: $('#draftLink'),
    mockups: $('#draftMockups'),
    cancel: $('#draftCancel'),
    close: $('#draftClose'),
  }

  let active = false // ce chemin est choisi. Toujours faux au chargement : les mockups restent le défaut.
  let run = null // la préparation à l'écran : { id, image, view, startedAt, offline }
  let createdImage = null // l'image du dernier brouillon créé : le bouton ne la reprend pas deux fois
  let ticker = null

  const isWorking = ({ stage }) => stage === 'preparing' || stage === 'creating'
  const isExpired = (res) => res.status === 401 || res.redirected

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

  function paintPhotos(media) {
    const grid = $('#draftPhotos')
    grid.innerHTML = ''
    media.forEach(({ photo, url, alt, filename }, index) => {
      const figure = document.createElement('figure')
      figure.className = 'draft-photo'
      const zoom = document.createElement('button')
      zoom.type = 'button'
      zoom.title = 'Agrandir'
      zoom.addEventListener('click', () => openLightbox(url))
      const image = document.createElement('img')
      image.src = url
      image.alt = alt
      image.loading = 'lazy'
      zoom.append(image)
      const caption = document.createElement('figcaption')
      const title = document.createElement('b')
      title.textContent = `${index + 1} · ${PHOTO_LABELS[photo] || photo}`
      const name = document.createElement('small')
      name.textContent = filename
      caption.append(title, alt, name)
      figure.append(zoom, caption)
      grid.append(figure)
    })
  }

  function paintTexts({ title, shortTitle, descriptionHtml, metaTitle, metaDescription, tags }) {
    const list = $('#draftTexts')
    list.innerHTML = ''
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
  }

  function paint() {
    const { view, startedAt, offline } = run
    const screen = draftScreen(view, Date.now() - startedAt, { offline })
    $('#draftTitle').textContent = screen.title
    $('#draftSpinner').classList.toggle('hidden', !screen.busy)
    paintSteps(screen.steps)
    const note = $('#draftNote')
    note.textContent = screen.note
    note.classList.toggle('hidden', !screen.note)
    const problem = $('#draftProblem')
    problem.textContent = screen.problem || ''
    problem.classList.toggle('hidden', !screen.problem)
    if (screen.review && review.classList.contains('hidden')) {
      paintPhotos(view.review.media)
      paintTexts(view.review)
    }
    review.classList.toggle('hidden', !screen.review)
    for (const [name, button] of Object.entries(buttons)) {
      button.classList.toggle('hidden', !screen.buttons.includes(name))
    }
    const adminUrl = view.product ? view.product.adminUrl : view.leftoverUrl
    if (adminUrl) buttons.link.href = adminUrl
  }

  function show() {
    overlay.classList.remove('hidden')
    document.body.classList.add('draft-open')
    review.classList.add('hidden')
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
    const current = { id: null, image, view: { stage: 'sending' }, startedAt: Date.now(), offline: false }
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
  async function send(current, action) {
    const { res, data } = await fetchJsonT(
      `${API}/api/artwork-drafts/${current.id}/${action}`,
      { method: 'POST', headers: HEADERS },
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

  async function order(action) {
    const current = run
    for (const button of Object.values(buttons)) button.disabled = true
    current.startedAt = Date.now()
    try {
      await send(current, action)
    } catch {
      toast('La connexion a été coupée. Réessayez dans un instant.', 'err')
    } finally {
      for (const button of Object.values(buttons)) button.disabled = false
    }
  }

  /**
   * false si l'annulation n'a pas pris : trop tard, ou un produit resté à retirer. L'écran reste alors
   * ouvert, sur le nouvel état. Sans réponse, il se ferme : rien ne se crée sans le clic de validation.
   */
  async function cancel() {
    const current = run
    if (current.id) {
      try {
        const { stage } = await send(current, 'cancel')
        if (stage !== 'cancelled') return false
      } catch {
        // Voir au-dessus.
      }
    }
    hide()
    return true
  }

  /* ---------- Choix du chemin ---------- */

  function choose(next) {
    if (next === active) return
    if (next) {
      if (
        state.results.length &&
        !confirm('Passer à la nouvelle fiche va effacer les rendus déjà générés. Continuer ?')
      )
        return
      clearResults() // arrête aussi un lot de favoris en cours : ni Photopea ni Gemini sur ce chemin
      state.lastBatchImage = null
    }
    active = next
    $$('#draftChoice .seg-btn').forEach((button) => {
      button.classList.toggle('active', (button.dataset.path === 'draft') === active)
    })
    $('#draftChoiceNote').classList.toggle('hidden', !active)
    $('#draftCard').classList.toggle('hidden', !active)
    for (const id of ['#productType', '#mockupsCard', '#resultsCard']) {
      $(id).classList.toggle('hidden', active)
    }
    if (!active) $('#publishBtn').textContent = "Publier l'œuvre"
    refreshAction()
    if (!active) maybeRunFavorites()
  }

  function refreshDraftAction() {
    const info = $('#actionInfo')
    const button = $('#publishBtn')
    button.textContent = 'Préparer les photos'
    if (state.needsResize) {
      info.textContent = "⚠️ Retaille l'image au bon format pour continuer"
      button.disabled = true
      return
    }
    if (state.imageDataUrl && state.imageDataUrl === createdImage) {
      info.textContent = 'Brouillon déjà créé pour cette image'
      button.disabled = true
      return
    }
    const parts = []
    if (state.orientation) parts.push(labelOri(state.orientation))
    if (state.collection) parts.push(state.collection.title)
    parts.push('Nouvelle fiche')
    info.textContent = parts.join(' · ')
    button.disabled = !(state.imageDataUrl && state.collection)
  }

  buttons.create.addEventListener('click', () => order('create'))
  buttons.retry.addEventListener('click', () => (run.id ? order('retry') : start()))
  buttons.cancel.addEventListener('click', cancel)
  buttons.close.addEventListener('click', hide)
  buttons.mockups.addEventListener('click', async () => {
    if (await cancel()) choose(false)
  })
  $$('#draftChoice .seg-btn').forEach((button) => {
    button.addEventListener('click', () => choose(button.dataset.path === 'draft'))
  })

  window.ArtworkDraftMode = {
    active: () => active,
    start,
    /** true : ce chemin a pris la barre d'action. Le choix ne se montre que pour une toile à créer. */
    refreshAction() {
      $('#draftChoice').classList.toggle('hidden', state.productType !== 'toile' || !!state.jumeau)
      if (active) refreshDraftAction()
      return active
    },
  }

  if (MODE === 'create') refreshAction()
})()
