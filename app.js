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
  var NEW_TODAY_KEY = LS_PREFIX + 'pwa-new-today'
  var DAILY_STATS_KEY = LS_PREFIX + 'pwa-daily-stats'
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24h

  // ── SM-2 quality mappings ──
  var Q_WRONG = 1
  var Q_RIGHT = 4

  // ── New cards daily limit (Improvement 1) ──
  var NEW_CARDS_PER_DAY = 20

  // ── Swipe threshold (Improvement 2) ──
  var SWIPE_MIN_DISTANCE = 50

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

  // ── Daily stats tracking (Improvement 5) ──
  function getDailyStats() {
    var stats = lsGet(DAILY_STATS_KEY)
    if (!stats || typeof stats !== 'object') stats = {}
    return stats
  }

  function updateDailyStats(quality) {
    var stats = getDailyStats()
    var today = todayStr()

    if (!stats[today]) {
      stats[today] = { reviewed: 0, correct: 0, wrong: 0 }
    }
    stats[today].reviewed++
    if (quality >= 3) {
      stats[today].correct++
    } else {
      stats[today].wrong++
    }

    // Keep only last 30 days
    var keys = Object.keys(stats).sort()
    while (keys.length > 30) {
      delete stats[keys.shift()]
    }

    lsSet(DAILY_STATS_KEY, stats)
  }

  // ── New cards today tracking (Improvement 1) ──
  function getNewTodayCount() {
    var data = lsGet(NEW_TODAY_KEY)
    var today = todayStr()
    if (data && data.date === today) return data.count
    return 0
  }

  function incrementNewToday() {
    var data = lsGet(NEW_TODAY_KEY)
    var today = todayStr()
    if (!data || data.date !== today) {
      data = { date: today, count: 0 }
    }
    data.count++
    lsSet(NEW_TODAY_KEY, data)
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

  // ── Get due cards with new-card limit (Improvement 1) ──
  function getDueCards(cards, certFilter, subtemaFilters) {
    var today = todayStr()
    var filtered = cards

    // Apply cert filter
    if (certFilter) {
      filtered = filtered.filter(function (c) { return c.cert === certFilter })
    }

    // Apply subtema filter (only when no cert filter is active)
    if (!certFilter && subtemaFilters && subtemaFilters.length > 0) {
      filtered = filtered.filter(function (c) {
        return subtemaFilters.indexOf(c.subtema) !== -1
      })
    }

    var reviewCards = []
    var newCards = []

    filtered.forEach(function (c) {
      var state = getCardState(c.id)
      if (state.nextReview <= today) {
        if (state.lastReview === null) {
          newCards.push(c)
        } else {
          reviewCards.push(c)
        }
      }
    })

    // Limit new cards to remaining daily quota
    var newTodayCount = getNewTodayCount()
    var remaining = Math.max(0, NEW_CARDS_PER_DAY - newTodayCount)
    var limitedNew = newCards.slice(0, remaining)

    return {
      review: reviewCards,
      new: limitedNew,
      newTotal: newCards.length,
      all: reviewCards.concat(limitedNew)
    }
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

    var activeCert = null
    var activeSubtemas = []

    // Compute due counts helper
    function computeDue() {
      return getDueCards(cards, activeCert, activeSubtemas)
    }

    var dueResult = computeDue()

    // Big due count number
    var countEl = el('div', 'due-count', String(dueResult.all.length))
    app.appendChild(countEl)

    // Breakdown label: "X pendientes (Y repaso + Z nuevas)"
    var labelEl = el('div', 'due-label')
    function updateLabel(result) {
      labelEl.innerHTML = result.all.length + ' pendientes' +
        '<span class="due-breakdown">(' + result.review.length + ' repaso + ' + result.new.length + ' nuevas)</span>'
    }
    updateLabel(dueResult)
    app.appendChild(labelEl)

    // Cert filter pills
    var pills = el('div', 'cert-pills')

    var certKeys = ['lpic-1', 'lpic-2', 'lpic-3']
    var certs = [{ key: null, label: 'Todas' }]
    certKeys.forEach(function (k) {
      certs.push({ key: k, label: k.toUpperCase() })
    })

    var pillEls = []

    function refreshAll() {
      var result = computeDue()
      countEl.textContent = result.all.length
      updateLabel(result)
      btnStart.textContent = 'Comenzar repaso (' + result.all.length + ' tarjetas)'
      btnStart.disabled = result.all.length === 0

      // Also refresh cert pill counts
      pillEls.forEach(function (p, pi) {
        var cr = getDueCards(cards, certs[pi].key, certs[pi].key ? [] : activeSubtemas)
        p.innerHTML = certs[pi].label + '<span class="count">' + cr.all.length + '</span>'
      })
    }

    certs.forEach(function (cert) {
      var pill = el('button', 'cert-pill' + (cert.key === null ? ' active' : ''))
      var certResult = getDueCards(cards, cert.key, cert.key ? [] : activeSubtemas)
      pill.innerHTML = cert.label + '<span class="count">' + certResult.all.length + '</span>'
      pill.addEventListener('click', function () {
        activeCert = cert.key
        pillEls.forEach(function (p) { p.classList.remove('active') })
        pill.classList.add('active')
        refreshAll()
      })
      pills.appendChild(pill)
      pillEls.push(pill)
    })
    app.appendChild(pills)

    // ── Subtema filter (Improvement 4) ──
    var subtemaSection = el('div', 'subtema-section')

    var subtemaToggle = el('button', 'subtema-toggle', 'Filtrar por tema')
    subtemaToggle.addEventListener('click', function () {
      subtemaSection.classList.toggle('open')
    })
    subtemaSection.appendChild(subtemaToggle)

    // Gather unique subtemas grouped by cert
    var subtemaByCert = {}
    cards.forEach(function (c) {
      if (!subtemaByCert[c.cert]) subtemaByCert[c.cert] = {}
      subtemaByCert[c.cert][c.subtema] = true
    })

    var subtemaScrollable = el('div', 'subtema-filter')
    var subtemaPillEls = []

    certKeys.forEach(function (certKey) {
      if (!subtemaByCert[certKey]) return

      // Group label
      var groupLabel = el('div', 'subtema-group', certKey.toUpperCase())
      subtemaScrollable.appendChild(groupLabel)

      // Pills container
      var groupPills = el('div', 'pills')
      var subtemas = Object.keys(subtemaByCert[certKey]).sort(function (a, b) {
        var partsA = a.split('.').map(Number)
        var partsB = b.split('.').map(Number)
        for (var i = 0; i < Math.max(partsA.length, partsB.length); i++) {
          var va = partsA[i] || 0
          var vb = partsB[i] || 0
          if (va !== vb) return va - vb
        }
        return 0
      })

      subtemas.forEach(function (st) {
        var sPill = el('button', 'subtema-pill', st)
        sPill.addEventListener('click', function () {
          var idx = activeSubtemas.indexOf(st)
          if (idx === -1) {
            activeSubtemas.push(st)
            sPill.classList.add('active')
          } else {
            activeSubtemas.splice(idx, 1)
            sPill.classList.remove('active')
          }
          refreshAll()
        })
        groupPills.appendChild(sPill)
        subtemaPillEls.push(sPill)
      })
      subtemaScrollable.appendChild(groupPills)
    })

    // Clear filters button
    var btnClear = el('button', 'btn-clear-filters', 'Limpiar filtros')
    btnClear.addEventListener('click', function () {
      activeSubtemas = []
      subtemaPillEls.forEach(function (p) { p.classList.remove('active') })
      refreshAll()
    })

    subtemaScrollable.appendChild(btnClear)
    subtemaSection.appendChild(subtemaScrollable)
    app.appendChild(subtemaSection)

    // Start button (shows card count)
    var btnStart = el('button', 'btn-start', 'Comenzar repaso (' + dueResult.all.length + ' tarjetas)')
    btnStart.disabled = dueResult.all.length === 0
    btnStart.addEventListener('click', function () {
      var result = computeDue()
      if (result.all.length === 0) return

      // Track new cards introduced today (Improvement 1)
      result.new.forEach(function () {
        incrementNewToday()
      })

      shuffle(result.all)
      showReview(cards, result.all)
    })
    app.appendChild(btnStart)

    // Stats row
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

    // ── Statistics button (Improvement 5) ──
    var btnStats = el('button', 'btn-update', 'Estadisticas')
    btnStats.style.marginTop = '16px'
    btnStats.addEventListener('click', function () {
      showStatistics(cards)
    })
    app.appendChild(btnStats)

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

    // ── Export/Import (Improvement 6) ──
    var dataActions = el('div', 'data-actions')

    var btnExport = el('button', 'btn-data', 'Exportar progreso')
    btnExport.addEventListener('click', function () {
      var data = {}
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i)
        if (key.indexOf(LS_PREFIX) === 0) {
          var val = localStorage.getItem(key)
          try { data[key] = JSON.parse(val) }
          catch (e) { data[key] = val }
        }
      }
      var backup = {
        version: 1,
        date: todayStr(),
        data: data
      }
      var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = 'pingunix-cards-backup-' + todayStr() + '.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })

    var btnImport = el('button', 'btn-data', 'Importar progreso')
    btnImport.addEventListener('click', function () {
      var input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.addEventListener('change', function (e) {
        var file = e.target.files[0]
        if (!file) return
        var reader = new FileReader()
        reader.onload = function (ev) {
          try {
            var backup = JSON.parse(ev.target.result)
            if (!backup.data || typeof backup.data !== 'object') {
              alert('Archivo de backup invalido.')
              return
            }
            var keys = Object.keys(backup.data)
            keys.forEach(function (key) {
              var val = backup.data[key]
              if (typeof val === 'string') {
                localStorage.setItem(key, val)
              } else {
                localStorage.setItem(key, JSON.stringify(val))
              }
            })
            // Reload home
            loadCards(false).then(function (newCards) {
              showHome(newCards)
            }).catch(function () {
              showHome(cards)
            })
          } catch (err) {
            alert('Error al leer el archivo: ' + err.message)
          }
        }
        reader.readAsText(file)
      })
      input.click()
    })

    dataActions.appendChild(btnExport)
    dataActions.appendChild(btnImport)
    app.appendChild(dataActions)
  }

  // ── Statistics Screen (Improvement 5) ──
  function showStatistics(cards) {
    app.innerHTML = ''

    var header = el('div', 'header')
    header.innerHTML = '<h1>Estadisticas</h1>'
    app.appendChild(header)

    var container = el('div', 'stats-screen')

    // a) Today stats
    var dailyStats = getDailyStats()
    var today = todayStr()
    var todayData = dailyStats[today] || { reviewed: 0, correct: 0, wrong: 0 }
    var accuracyToday = todayData.reviewed > 0 ? Math.round((todayData.correct / todayData.reviewed) * 100) : 0

    var todaySection = el('div', 'stats-section')
    todaySection.innerHTML =
      '<h3>Hoy</h3>' +
      '<div>Tarjetas revisadas: <strong>' + todayData.reviewed + '</strong></div>' +
      '<div>Precision: <strong>' + accuracyToday + '%</strong></div>'
    container.appendChild(todaySection)

    // b) Last 7 days bar chart
    var histSection = el('div', 'stats-section')
    var histTitle = el('h3', '', 'Historial (ultimos 7 dias)')
    histSection.appendChild(histTitle)

    var chartDiv = el('div', 'bar-chart')

    var days = []
    for (var i = 6; i >= 0; i--) {
      days.push(addDays(new Date(), -i))
    }

    var maxReviewed = 0
    days.forEach(function (day) {
      var d = dailyStats[day]
      if (d && d.reviewed > maxReviewed) maxReviewed = d.reviewed
    })

    days.forEach(function (day) {
      var d = dailyStats[day] || { reviewed: 0 }
      var pct = maxReviewed > 0 ? Math.round((d.reviewed / maxReviewed) * 100) : 0
      var barRow = el('div', 'bar-row')
      barRow.innerHTML =
        '<span class="label">' + day.slice(5) + '</span>' +
        '<div class="track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="count">' + d.reviewed + '</span>'
      chartDiv.appendChild(barRow)
    })
    histSection.appendChild(chartDiv)
    container.appendChild(histSection)

    // c) Maturity
    var matNew = 0
    var matLearning = 0
    var matMature = 0
    cards.forEach(function (c) {
      var s = getCardState(c.id)
      if (s.lastReview === null) {
        matNew++
      } else if (s.interval < 7) {
        matLearning++
      } else {
        matMature++
      }
    })

    var total = cards.length || 1
    var pctNew = Math.round((matNew / total) * 100)
    var pctLearning = Math.round((matLearning / total) * 100)
    var pctMature = Math.round((matMature / total) * 100)

    var matSection = el('div', 'stats-section')
    matSection.innerHTML =
      '<h3>Madurez</h3>' +
      '<div class="maturity-bars">' +
        '<div class="segment segment-new" style="width:' + pctNew + '%"></div>' +
        '<div class="segment segment-learning" style="width:' + pctLearning + '%"></div>' +
        '<div class="segment segment-mature" style="width:' + pctMature + '%"></div>' +
      '</div>' +
      '<div class="maturity-legend">' +
        '<div class="legend-item"><span class="dot dot-new"></span>Nuevas: ' + matNew + '</div>' +
        '<div class="legend-item"><span class="dot dot-learning"></span>Aprendiendo: ' + matLearning + '</div>' +
        '<div class="legend-item"><span class="dot dot-mature"></span>Maduras: ' + matMature + '</div>' +
      '</div>'
    container.appendChild(matSection)

    // d) Per certification
    var certBreakdown = {}
    cards.forEach(function (c) {
      if (!certBreakdown[c.cert]) {
        certBreakdown[c.cert] = { total: 0, seen: 0 }
      }
      certBreakdown[c.cert].total++
      var s = getCardState(c.id)
      if (s.lastReview !== null) certBreakdown[c.cert].seen++
    })

    var certSection = el('div', 'stats-section')
    var certTitle = el('h3', '', 'Por certificacion')
    certSection.appendChild(certTitle)

    Object.keys(certBreakdown).sort().forEach(function (cert) {
      var b = certBreakdown[cert]
      var pctSeen = b.total > 0 ? Math.round((b.seen / b.total) * 100) : 0
      var row = el('div', 'cert-progress')
      row.innerHTML =
        '<span class="cert-name">' + cert.toUpperCase() + '</span>' +
        '<div class="mini-bar"><div class="mini-bar-fill" style="width:' + pctSeen + '%"></div></div>' +
        '<span class="pct">' + pctSeen + '%</span>'
      certSection.appendChild(row)
    })
    container.appendChild(certSection)

    app.appendChild(container)

    // Back button
    var btnBack = el('button', 'btn-secondary', 'Volver')
    btnBack.style.marginTop = '24px'
    btnBack.addEventListener('click', function () {
      loadCards(false).then(function (c) { showHome(c) }).catch(function () { showHome(cards) })
    })
    app.appendChild(btnBack)
  }

  // ── Review Screen ──
  function showReview(allCards, dueCards) {
    app.innerHTML = ''
    var idx = 0
    var isFlipped = false
    var results = [] // { id, quality }
    var ratingInProgress = false // prevent double-rating during toast delay

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

    // Interval toast (Improvement 3) — positioned over the card area
    var intervalToast = el('div', 'interval-toast')
    intervalToast.style.display = 'none'
    cardArea.appendChild(intervalToast)

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
      ratingInProgress = false
      card.classList.remove('flipped')
      card.classList.remove('card-swipe-left')
      card.classList.remove('card-swipe-right')
      ratingArea.classList.add('hidden')
      flipHint.classList.remove('hidden')
      intervalToast.style.display = 'none'

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
      if (!isFlipped || ratingInProgress) return
      ratingInProgress = true

      var c = dueCards[idx]
      var newState = rateCard(c.id, quality)
      results.push({ id: c.id, quality: quality })

      // Update daily stats (Improvement 5)
      updateDailyStats(quality)

      // Show interval toast (Improvement 3)
      var toastMsg = ''
      if (quality < 3) {
        toastMsg = 'Repetir ma\u00F1ana'
      } else {
        toastMsg = 'Proxima revision: en ' + newState.interval + ' dia' + (newState.interval !== 1 ? 's' : '')
      }
      intervalToast.textContent = toastMsg
      intervalToast.style.display = ''
      // Re-trigger CSS animation by removing and re-adding the element
      var parent = intervalToast.parentNode
      parent.removeChild(intervalToast)
      intervalToast = el('div', 'interval-toast')
      intervalToast.textContent = toastMsg
      parent.appendChild(intervalToast)

      setTimeout(function () {
        idx++
        display()
      }, 600)
    }

    // ── Swipe gestures (Improvement 2) ──
    var touchStartX = 0
    var isSwiping = false

    cardArea.addEventListener('touchstart', function (e) {
      if (!isFlipped || ratingInProgress) return
      var touch = e.touches[0]
      touchStartX = touch.clientX
      isSwiping = true
    }, { passive: true })

    cardArea.addEventListener('touchmove', function (e) {
      if (!isSwiping || !isFlipped || ratingInProgress) return
      var touch = e.touches[0]
      var dx = touch.clientX - touchStartX

      // Visual feedback during swipe
      if (dx > 20) {
        card.classList.add('card-swipe-right')
        card.classList.remove('card-swipe-left')
      } else if (dx < -20) {
        card.classList.add('card-swipe-left')
        card.classList.remove('card-swipe-right')
      } else {
        card.classList.remove('card-swipe-left')
        card.classList.remove('card-swipe-right')
      }
    }, { passive: true })

    cardArea.addEventListener('touchend', function (e) {
      if (!isSwiping || !isFlipped || ratingInProgress) {
        isSwiping = false
        return
      }
      var touch = e.changedTouches[0]
      var dx = touch.clientX - touchStartX
      isSwiping = false

      if (Math.abs(dx) >= SWIPE_MIN_DISTANCE) {
        if (dx > 0) {
          // Swipe right = correct
          card.classList.add('card-swipe-right')
          card.classList.remove('card-swipe-left')
          rate(Q_RIGHT)
        } else {
          // Swipe left = wrong
          card.classList.add('card-swipe-left')
          card.classList.remove('card-swipe-right')
          rate(Q_WRONG)
        }
      } else {
        card.classList.remove('card-swipe-left')
        card.classList.remove('card-swipe-right')
      }
    })

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
