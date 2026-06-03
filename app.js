/* === Pingunix Cards — Lightweight Flashcard PWA === */

;(function () {
  'use strict'

  // ── Constants ──
  var DATA_URL = 'https://rricajos.github.io/pingunix/static/flashcards-all.json'
  var LS_PREFIX = 'lpic-study:'
  var FC_PREFIX = LS_PREFIX + 'fc:'
  var CARDS_CACHE_KEY = LS_PREFIX + 'cards-data'
  var CARDS_TS_KEY = LS_PREFIX + 'cards-ts'
  var STREAK_KEY = LS_PREFIX + 'pwa-streak'
  var LAST_REVIEW_KEY = LS_PREFIX + 'pwa-last-review'
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24h

  // ── SM-2 quality mappings ──
  var Q_WRONG = 1
  var Q_RIGHT = 4

  // ── Helpers ──
  var $ = document.getElementById.bind(document)
  var app = $('app')

  function todayStr() {
    var d = new Date()
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0')
  }

  function addDays(date, days) {
    var d = new Date(date)
    d.setDate(d.getDate() + days)
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0')
  }

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) }
    catch (e) { return null }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)) }
    catch (e) { /* quota exceeded */ }
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t
    }
    return arr
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  // ── Streak tracking ──
  function updateStreak() {
    var today = todayStr()
    var last = localStorage.getItem(LAST_REVIEW_KEY)
    var streak = parseInt(localStorage.getItem(STREAK_KEY)) || 0

    if (last === today) return streak // already counted today

    var yesterday = addDays(new Date(), -1)
    if (last === yesterday) {
      streak++
    } else if (last !== today) {
      streak = 1
    }

    localStorage.setItem(STREAK_KEY, streak)
    localStorage.setItem(LAST_REVIEW_KEY, today)
    return streak
  }

  function getStreak() {
    var last = localStorage.getItem(LAST_REVIEW_KEY)
    var streak = parseInt(localStorage.getItem(STREAK_KEY)) || 0
    if (!last) return 0
    var today = todayStr()
    var yesterday = addDays(new Date(), -1)
    if (last === today || last === yesterday) return streak
    return 0 // streak broken
  }

  // ── Data loading ──
  function loadCards(forceRefresh) {
    return new Promise(function (resolve, reject) {
      var cached = localStorage.getItem(CARDS_CACHE_KEY)
      var ts = parseInt(localStorage.getItem(CARDS_TS_KEY)) || 0
      var fresh = Date.now() - ts < CACHE_MAX_AGE

      if (cached && fresh && !forceRefresh) {
        try { return resolve(JSON.parse(cached)) }
        catch (e) { /* corrupted cache, refetch */ }
      }

      fetch(DATA_URL)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.text()
        })
        .then(function (text) {
          localStorage.setItem(CARDS_CACHE_KEY, text)
          localStorage.setItem(CARDS_TS_KEY, Date.now())
          resolve(JSON.parse(text))
        })
        .catch(function () {
          if (cached) {
            try { return resolve(JSON.parse(cached)) }
            catch (e) { /* fall through */ }
          }
          reject(new Error('No se pudieron cargar las tarjetas. Comprueba tu conexion.'))
        })
    })
  }

  // ── SM-2 state for a card ──
  function getCardState(id) {
    var state = lsGet(FC_PREFIX + id)
    if (state) return state
    return {
      easeFactor: 2.5,
      interval: 1,
      repetitions: 0,
      nextReview: todayStr(),
      lastReview: null,
      lastQuality: null,
    }
  }

  function rateCard(id, quality) {
    var s = getCardState(id)

    if (quality >= 3) {
      if (s.repetitions === 0) s.interval = 1
      else if (s.repetitions === 1) s.interval = 6
      else s.interval = Math.round(s.interval * s.easeFactor)
      s.repetitions++
    } else {
      s.repetitions = 0
      s.interval = 1
    }

    s.easeFactor = Math.max(
      1.3,
      s.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    )
    s.lastReview = todayStr()
    s.nextReview = addDays(new Date(), s.interval)
    s.lastQuality = quality

    lsSet(FC_PREFIX + id, s)
    return s
  }

  // ── Get due cards ──
  function getDueCards(cards, certFilter) {
    var today = todayStr()
    var filtered = certFilter ? cards.filter(function (c) { return c.cert === certFilter }) : cards
    return filtered.filter(function (c) {
      var state = getCardState(c.id)
      return state.nextReview <= today
    })
  }

  // ── Screens ──

  function showLoading() {
    app.innerHTML = '<div class="loading"><div class="spinner"></div>Cargando tarjetas...</div>'
  }

  function showError(msg) {
    app.innerHTML = '<div class="error-msg">' + msg + '</div>'
  }

  // ── Home Screen ──
  function showHome(cards) {
    app.innerHTML = ''

    var header = el('div', 'header')
    header.innerHTML = '<h1>Pingunix Cards</h1><div class="subtitle">Repaso con repeticion espaciada</div>'
    app.appendChild(header)

    var today = todayStr()
    var dueCounts = { all: 0, 'lpic-1': 0, 'lpic-2': 0, 'lpic-3': 0 }
    cards.forEach(function (c) {
      var state = getCardState(c.id)
      if (state.nextReview <= today) {
        dueCounts.all++
        dueCounts[c.cert]++
      }
    })

    var countEl = el('div', 'due-count', String(dueCounts.all))
    app.appendChild(countEl)

    var labelEl = el('div', 'due-label', 'tarjetas pendientes hoy')
    app.appendChild(labelEl)

    // Cert filter pills
    var pills = el('div', 'cert-pills')
    var activeCert = null

    var certs = [
      { key: null, label: 'Todas', count: dueCounts.all },
      { key: 'lpic-1', label: 'LPIC-1', count: dueCounts['lpic-1'] },
      { key: 'lpic-2', label: 'LPIC-2', count: dueCounts['lpic-2'] },
      { key: 'lpic-3', label: 'LPIC-3', count: dueCounts['lpic-3'] },
    ]

    var pillEls = []

    certs.forEach(function (cert) {
      var pill = el('button', 'cert-pill' + (cert.key === null ? ' active' : ''))
      pill.innerHTML = cert.label + '<span class="count">' + cert.count + '</span>'
      pill.addEventListener('click', function () {
        activeCert = cert.key
        pillEls.forEach(function (p) { p.classList.remove('active') })
        pill.classList.add('active')
        var due = cert.count
        countEl.textContent = due
        btnStart.disabled = due === 0
      })
      pills.appendChild(pill)
      pillEls.push(pill)
    })
    app.appendChild(pills)

    // Start button
    var btnStart = el('button', 'btn-start', 'Comenzar repaso')
    btnStart.disabled = dueCounts.all === 0
    btnStart.addEventListener('click', function () {
      var due = getDueCards(cards, activeCert)
      if (due.length === 0) return
      shuffle(due)
      showReview(cards, due)
    })
    app.appendChild(btnStart)

    // Stats
    var streak = getStreak()
    var totalReviewed = 0
    cards.forEach(function (c) {
      var s = getCardState(c.id)
      if (s.lastReview) totalReviewed++
    })

    var stats = el('div', 'stats-row')
    stats.innerHTML =
      '<div class="stat"><div class="stat-num">' + streak + '</div><div class="stat-label">dias de racha</div></div>' +
      '<div class="stat"><div class="stat-num">' + totalReviewed + '</div><div class="stat-label">tarjetas vistas</div></div>' +
      '<div class="stat"><div class="stat-num">' + cards.length + '</div><div class="stat-label">total tarjetas</div></div>'
    app.appendChild(stats)

    // Update button
    var btnUpdate = el('button', 'btn-update', 'Actualizar tarjetas')
    btnUpdate.addEventListener('click', function () {
      btnUpdate.textContent = 'Actualizando...'
      btnUpdate.disabled = true
      loadCards(true).then(function (newCards) {
        showHome(newCards)
      }).catch(function () {
        btnUpdate.textContent = 'Error — reintentar'
        btnUpdate.disabled = false
      })
    })
    app.appendChild(btnUpdate)
  }

  // ── Review Screen ──
  function showReview(allCards, dueCards) {
    app.innerHTML = ''
    var idx = 0
    var isFlipped = false
    var results = [] // { id, quality }

    // Header
    var reviewHeader = el('div', 'review-header')
    var progressText = el('div', 'review-progress-text')
    var btnClose = el('button', 'btn-close', '\u00D7')
    btnClose.addEventListener('click', function () { showHome(allCards) })
    reviewHeader.appendChild(progressText)
    reviewHeader.appendChild(btnClose)
    app.appendChild(reviewHeader)

    // Progress bar
    var progressBar = el('div', 'progress-bar')
    var progressFill = el('div', 'progress-fill')
    progressBar.appendChild(progressFill)
    app.appendChild(progressBar)

    // Card area
    var cardArea = el('div', 'card-area')
    var card = el('div', 'card')
    var front = el('div', 'card-face card-front')
    var back = el('div', 'card-face card-back')
    card.appendChild(front)
    card.appendChild(back)
    cardArea.appendChild(card)
    app.appendChild(cardArea)

    // Flip hint
    var flipHint = el('div', 'flip-hint', 'Toca la tarjeta o pulsa espacio para voltear')
    app.appendChild(flipHint)

    // Rating buttons
    var ratingArea = el('div', 'rating-area hidden')
    var btnWrong = el('button', 'btn-wrong', 'Me equivoque')
    var btnRight = el('button', 'btn-right', 'Acierto')
    btnWrong.addEventListener('click', function () { rate(Q_WRONG) })
    btnRight.addEventListener('click', function () { rate(Q_RIGHT) })
    ratingArea.appendChild(btnWrong)
    ratingArea.appendChild(btnRight)
    app.appendChild(ratingArea)

    function display() {
      if (idx >= dueCards.length) {
        showSummary(allCards, dueCards, results)
        return
      }
      var c = dueCards[idx]
      isFlipped = false
      card.classList.remove('flipped')
      ratingArea.classList.add('hidden')
      flipHint.classList.remove('hidden')

      front.innerHTML =
        '<div class="card-label">Pregunta</div>' +
        '<div class="card-text">' + escapeHtml(c.q) + '</div>' +
        '<div class="card-meta">' + c.subtema + '</div>'

      back.innerHTML =
        '<div class="card-label">Respuesta</div>' +
        '<div class="card-text">' + escapeHtml(c.a) + '</div>' +
        '<div class="card-meta">' + c.subtema + '</div>'

      var pct = dueCards.length > 0 ? Math.round((idx / dueCards.length) * 100) : 0
      progressFill.style.width = pct + '%'
      progressText.innerHTML = '<strong>' + (idx + 1) + '</strong> / ' + dueCards.length
    }

    function flipCard() {
      if (idx >= dueCards.length || isFlipped) return
      isFlipped = true
      card.classList.add('flipped')
      ratingArea.classList.remove('hidden')
      flipHint.classList.add('hidden')
    }

    function rate(quality) {
      if (!isFlipped) return
      var c = dueCards[idx]
      rateCard(c.id, quality)
      results.push({ id: c.id, quality: quality })
      idx++
      display()
    }

    // Events
    card.addEventListener('click', flipCard)

    function onKey(e) {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        if (!isFlipped) flipCard()
        else rate(Q_RIGHT)
      } else if (e.key === '1') {
        if (isFlipped) rate(Q_WRONG)
      } else if (e.key === '2') {
        if (isFlipped) rate(Q_RIGHT)
      } else if (e.key === 'Escape') {
        showHome(allCards)
      }
    }

    document.addEventListener('keydown', onKey)

    // Clean up key listener when leaving review
    var origInner = app.innerHTML
    var observer = new MutationObserver(function () {
      if (app.innerHTML !== origInner) {
        document.removeEventListener('keydown', onKey)
        observer.disconnect()
      }
    })
    observer.observe(app, { childList: true })

    display()
    updateStreak()
  }

  // ── Summary Screen ──
  function showSummary(allCards, dueCards, results) {
    app.innerHTML = ''

    var good = results.filter(function (r) { return r.quality >= 3 }).length
    var wrong = results.filter(function (r) { return r.quality < 3 }).length

    var summary = el('div', 'summary')

    summary.innerHTML =
      '<h2>Sesion completada</h2>' +
      '<div class="summary-stats">' +
        '<div class="summary-stat"><div class="summary-num green">' + good + '</div><div class="summary-label">Aciertos</div></div>' +
        '<div class="summary-stat"><div class="summary-num red">' + wrong + '</div><div class="summary-label">Fallos</div></div>' +
        '<div class="summary-stat"><div class="summary-num">' + results.length + '</div><div class="summary-label">Total</div></div>' +
      '</div>'

    app.appendChild(summary)

    var actions = el('div', 'summary-actions')
    summary.appendChild(actions)

    // Retry wrong cards
    if (wrong > 0) {
      var wrongCards = []
      results.forEach(function (r) {
        if (r.quality < 3) {
          var c = dueCards.find(function (d) { return d.id === r.id })
          if (c) wrongCards.push(c)
        }
      })

      var btnRetry = el('button', 'btn-start', 'Repetir falladas (' + wrong + ')')
      btnRetry.addEventListener('click', function () {
        shuffle(wrongCards)
        showReview(allCards, wrongCards)
      })
      actions.appendChild(btnRetry)
    }

    var btnHome = el('button', 'btn-secondary', 'Volver al inicio')
    btnHome.addEventListener('click', function () { showHome(allCards) })
    actions.appendChild(btnHome)
  }

  // ── Escape HTML ──
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Offline indicator ──
  function setupOffline() {
    var bar = $('offline-bar')
    function update() {
      if (navigator.onLine) bar.classList.add('hidden')
      else bar.classList.remove('hidden')
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    update()
  }

  // ── Service Worker ──
  function registerSW() {
    if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      navigator.serviceWorker.register('sw.js')
        .then(function (reg) { console.log('[SW] Registered, scope:', reg.scope) })
        .catch(function (err) { console.warn('[SW] Failed:', err) })
    }
  }

  // ── Init ──
  function init() {
    registerSW()
    setupOffline()
    showLoading()

    loadCards(false)
      .then(function (cards) {
        showHome(cards)
      })
      .catch(function (err) {
        showError(err.message)
      })
  }

  init()
})()
