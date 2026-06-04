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
  var THEME_KEY = LS_PREFIX + 'pwa-theme'
  var ONBOARDING_KEY = LS_PREFIX + 'pwa-onboarding-done'
  var SETTINGS_KEY = LS_PREFIX + 'pwa-settings'
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24h

  // ── SM-2 quality mappings ──
  var Q_WRONG = 1
  var Q_RIGHT = 4

  // ── Default settings ──
  var DEFAULT_SETTINGS = {
    newCardsPerDay: 20,
    notifications: false
  }

  // ── Swipe threshold ──
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

  // ── Settings ──
  function getSettings() {
    var s = lsGet(SETTINGS_KEY)
    if (!s || typeof s !== 'object') return Object.assign({}, DEFAULT_SETTINGS)
    return Object.assign({}, DEFAULT_SETTINGS, s)
  }

  function setSettings(s) {
    lsSet(SETTINGS_KEY, s)
  }

  // ── Theme management ──
  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark'
  }

  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    // Update meta theme-color
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#f4f4f6' : '#284b63')
    }
  }

  // ── Escape HTML ──
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Markdown-lite rendering (Feature 1) ──
  function formatCardText(str) {
    var s = escapeHtml(str)
    // Inline code: `code` → <code>
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold: **text** → <strong>
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Line breaks
    s = s.replace(/\n/g, '<br>')
    return s
  }

  // ── Format time duration ──
  function formatDuration(ms) {
    var secs = Math.floor(ms / 1000)
    var mins = Math.floor(secs / 60)
    secs = secs % 60
    if (mins > 0) return mins + 'm ' + secs + 's'
    return secs + 's'
  }

  // ── Streak tracking ──
  function updateStreak() {
    var today = todayStr()
    var last = localStorage.getItem(LAST_REVIEW_KEY)
    var streak = parseInt(localStorage.getItem(STREAK_KEY)) || 0

    if (last === today) return streak

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
    return 0
  }

  // ── Daily stats tracking ──
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

    var keys = Object.keys(stats).sort()
    while (keys.length > 30) {
      delete stats[keys.shift()]
    }

    lsSet(DAILY_STATS_KEY, stats)
  }

  function revertDailyStats(quality) {
    var stats = getDailyStats()
    var today = todayStr()
    if (!stats[today]) return
    stats[today].reviewed = Math.max(0, stats[today].reviewed - 1)
    if (quality >= 3) {
      stats[today].correct = Math.max(0, stats[today].correct - 1)
    } else {
      stats[today].wrong = Math.max(0, stats[today].wrong - 1)
    }
    lsSet(DAILY_STATS_KEY, stats)
  }

  // ── New cards today tracking ──
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

  function decrementNewToday() {
    var data = lsGet(NEW_TODAY_KEY)
    var today = todayStr()
    if (!data || data.date !== today) return
    data.count = Math.max(0, data.count - 1)
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

  // ── Get due cards with new-card limit ──
  function getDueCards(cards, certFilter, subtemaFilters) {
    var today = todayStr()
    var filtered = cards
    var settings = getSettings()

    if (certFilter) {
      filtered = filtered.filter(function (c) { return c.cert === certFilter })
    }

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

    var newTodayCount = getNewTodayCount()
    var remaining = Math.max(0, settings.newCardsPerDay - newTodayCount)
    var limitedNew = newCards.slice(0, remaining)

    return {
      review: reviewCards,
      new: limitedNew,
      newTotal: newCards.length,
      all: reviewCards.concat(limitedNew)
    }
  }

  // ── Confetti animation ──
  function launchConfetti() {
    var canvas = document.createElement('canvas')
    canvas.className = 'confetti-canvas'
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    document.body.appendChild(canvas)
    var ctx = canvas.getContext('2d')
    var particles = []
    var colors = ['#4caf50', '#7b97aa', '#84a59d', '#e05252', '#d4a24e', '#fff']
    for (var i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 8 + 4,
        h: Math.random() * 4 + 2,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3 + 2,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 1
      })
    }
    var frame = 0
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      var alive = false
      particles.forEach(function (p) {
        if (p.opacity <= 0) return
        alive = true
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.05
        p.rot += p.vr
        if (frame > 60) p.opacity -= 0.015
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot * Math.PI / 180)
        ctx.globalAlpha = Math.max(0, p.opacity)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      })
      frame++
      if (alive && frame < 180) {
        requestAnimationFrame(draw)
      } else {
        document.body.removeChild(canvas)
      }
    }
    requestAnimationFrame(draw)
  }

  // ── Haptic feedback ──
  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 10)
  }

  // ── Forecast: cards due in future days ──
  function getForecast(cards) {
    var counts = { d1: 0, d3: 0, d7: 0 }
    var tomorrow = addDays(new Date(), 1)
    var in3 = addDays(new Date(), 3)
    var in7 = addDays(new Date(), 7)
    cards.forEach(function (c) {
      var s = getCardState(c.id)
      var nr = s.nextReview
      if (!nr) return
      if (nr <= tomorrow) counts.d1++
      if (nr <= in3) counts.d3++
      if (nr <= in7) counts.d7++
    })
    return counts
  }

  // ── Notifications (Feature 3) ──
  function requestNotificationPermission(callback) {
    if (!('Notification' in window)) {
      if (callback) callback(false)
      return
    }
    if (Notification.permission === 'granted') {
      if (callback) callback(true)
      return
    }
    if (Notification.permission === 'denied') {
      if (callback) callback(false)
      return
    }
    Notification.requestPermission().then(function (perm) {
      if (callback) callback(perm === 'granted')
    })
  }

  function showDueNotification(count) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    var settings = getSettings()
    if (!settings.notifications) return

    try {
      new Notification('Pingunix Cards', {
        body: 'Tienes ' + count + ' tarjetas pendientes de repaso',
        icon: 'icon-192.png',
        tag: 'due-reminder'
      })
    } catch (e) {
      // SW notification fallback
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification('Pingunix Cards', {
            body: 'Tienes ' + count + ' tarjetas pendientes de repaso',
            icon: 'icon-192.png',
            tag: 'due-reminder'
          })
        })
      }
    }
  }

  // ── PWA Install Prompt ──
  var deferredInstallPrompt = null
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault()
    deferredInstallPrompt = e
  })

  // ── Screen transitions ──
  function transitionTo(renderFn) {
    app.classList.add('screen-exit')
    setTimeout(function () {
      renderFn()
      app.classList.remove('screen-exit')
      app.classList.add('screen-enter')
      setTimeout(function () {
        app.classList.remove('screen-enter')
      }, 250)
    }, 150)
  }

  // ── Screens ──

  function showLoading() {
    app.innerHTML =
      '<div class="skeleton-screen">' +
        '<div class="skeleton-header"><div class="skeleton-line skeleton-title"></div><div class="skeleton-line skeleton-subtitle"></div></div>' +
        '<div class="skeleton-count"></div>' +
        '<div class="skeleton-pills"><div class="skeleton-pill"></div><div class="skeleton-pill"></div><div class="skeleton-pill"></div><div class="skeleton-pill"></div></div>' +
        '<div class="skeleton-btn"></div>' +
        '<div class="skeleton-stats"><div class="skeleton-stat"></div><div class="skeleton-stat"></div><div class="skeleton-stat"></div></div>' +
      '</div>'
  }

  function showError(msg) {
    app.innerHTML = '<div class="error-msg">' + msg + '</div>'
  }

  // ── Onboarding (Feature 6) ──
  function showOnboarding(cards) {
    var overlay = el('div', 'onboarding-overlay')
    var card = el('div', 'onboarding-card')

    card.innerHTML =
      '<h2>Bienvenido a Pingunix Cards</h2>' +
      '<div class="onb-item"><span class="onb-icon">&#128073;</span><div class="onb-text">Toca la tarjeta o pulsa <kbd>Espacio</kbd> para voltear</div></div>' +
      '<div class="onb-item"><span class="onb-icon">&#10060;</span><div class="onb-text"><strong>Me equivoque</strong> &mdash; reinicia el intervalo (tecla <kbd>1</kbd> o swipe izquierda)</div></div>' +
      '<div class="onb-item"><span class="onb-icon">&#9989;</span><div class="onb-text"><strong>Acierto</strong> &mdash; aumenta el intervalo (tecla <kbd>2</kbd> / <kbd>Espacio</kbd> o swipe derecha)</div></div>' +
      '<div class="onb-item"><span class="onb-icon">&#128197;</span><div class="onb-text">La repeticion espaciada (SM-2) programa las tarjetas automaticamente</div></div>'

    var btnGo = el('button', 'btn-start', 'Empezar')
    btnGo.addEventListener('click', function () {
      lsSet(ONBOARDING_KEY, true)
      document.body.removeChild(overlay)
      showHome(cards)
    })
    card.appendChild(btnGo)

    overlay.appendChild(card)
    document.body.appendChild(overlay)
  }

  // ── Home Screen ──
  function showHome(cards) {
    app.innerHTML = ''
    app.setAttribute('role', 'main')
    app.setAttribute('aria-label', 'Pingunix Cards')

    var header = el('div', 'header')
    header.setAttribute('role', 'banner')
    header.innerHTML = '<h1>Pingunix Cards</h1><div class="subtitle">Repaso con repeticion espaciada</div>'

    // Theme toggle
    var themeBtn = el('button', 'theme-toggle')
    themeBtn.textContent = getTheme() === 'dark' ? '\u2600' : '\uD83C\uDF19'
    themeBtn.setAttribute('aria-label', 'Cambiar tema')
    themeBtn.addEventListener('click', function () {
      vibrate(10)
      var next = getTheme() === 'dark' ? 'light' : 'dark'
      setTheme(next)
      themeBtn.textContent = next === 'dark' ? '\u2600' : '\uD83C\uDF19'
    })
    header.appendChild(themeBtn)
    app.appendChild(header)

    // Pull-to-refresh
    var pullIndicator = el('div', 'pull-indicator')
    pullIndicator.textContent = '\u2193 Tira para actualizar'
    app.appendChild(pullIndicator)

    var pullStartY = 0
    var isPulling = false
    var pullTriggered = false

    app.addEventListener('touchstart', function (e) {
      if (app.scrollTop > 0) return
      pullStartY = e.touches[0].clientY
      isPulling = true
      pullTriggered = false
    }, { passive: true })

    app.addEventListener('touchmove', function (e) {
      if (!isPulling) return
      var dy = e.touches[0].clientY - pullStartY
      if (dy > 10 && app.scrollTop <= 0) {
        var progress = Math.min(dy / 120, 1)
        pullIndicator.style.transform = 'translateY(' + (progress * 48 - 48) + 'px)'
        pullIndicator.style.opacity = progress
        if (dy > 120 && !pullTriggered) {
          pullTriggered = true
          pullIndicator.textContent = '\u2191 Suelta para actualizar'
        } else if (dy <= 120 && pullTriggered) {
          pullTriggered = false
          pullIndicator.textContent = '\u2193 Tira para actualizar'
        }
      }
    }, { passive: true })

    app.addEventListener('touchend', function () {
      if (!isPulling) return
      isPulling = false
      if (pullTriggered) {
        pullIndicator.textContent = 'Actualizando...'
        pullIndicator.style.transform = 'translateY(0)'
        loadCards(true).then(function (newCards) {
          transitionTo(function () { showHome(newCards) })
        }).catch(function () {
          pullIndicator.style.transform = 'translateY(-48px)'
          pullIndicator.style.opacity = '0'
        })
      } else {
        pullIndicator.style.transform = 'translateY(-48px)'
        pullIndicator.style.opacity = '0'
      }
    })

    var activeCert = null
    var activeSubtemas = []

    function computeDue() {
      return getDueCards(cards, activeCert, activeSubtemas)
    }

    var dueResult = computeDue()

    // Big due count number
    var countEl = el('div', 'due-count', String(dueResult.all.length))
    app.appendChild(countEl)

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

    // Subtema filter
    var subtemaSection = el('div', 'subtema-section')
    var subtemaToggle = el('button', 'subtema-toggle', 'Filtrar por tema')
    subtemaToggle.addEventListener('click', function () {
      subtemaSection.classList.toggle('open')
    })
    subtemaSection.appendChild(subtemaToggle)

    var subtemaByCert = {}
    cards.forEach(function (c) {
      if (!subtemaByCert[c.cert]) subtemaByCert[c.cert] = {}
      subtemaByCert[c.cert][c.subtema] = true
    })

    var subtemaScrollable = el('div', 'subtema-filter')
    var subtemaPillEls = []

    certKeys.forEach(function (certKey) {
      if (!subtemaByCert[certKey]) return
      var groupLabel = el('div', 'subtema-group', certKey.toUpperCase())
      subtemaScrollable.appendChild(groupLabel)

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

    var btnClear = el('button', 'btn-clear-filters', 'Limpiar filtros')
    btnClear.addEventListener('click', function () {
      activeSubtemas = []
      subtemaPillEls.forEach(function (p) { p.classList.remove('active') })
      refreshAll()
    })

    subtemaScrollable.appendChild(btnClear)
    subtemaSection.appendChild(subtemaScrollable)
    app.appendChild(subtemaSection)

    // Start button or empty state
    if (dueResult.all.length === 0) {
      var emptyState = el('div', 'empty-state')
      // Find next review date
      var nextDate = null
      cards.forEach(function (c) {
        var s = getCardState(c.id)
        if (s.nextReview && (!nextDate || s.nextReview < nextDate)) {
          nextDate = s.nextReview
        }
      })
      var nextMsg = nextDate ? 'Proximas tarjetas: ' + nextDate : ''
      emptyState.innerHTML =
        '<div class="empty-icon">&#127881;</div>' +
        '<div class="empty-title">Todo al dia</div>' +
        '<div class="empty-sub">No tienes tarjetas pendientes ahora</div>' +
        (nextMsg ? '<div class="empty-next">' + nextMsg + '</div>' : '')
      app.appendChild(emptyState)
    } else {
      var btnStart = el('button', 'btn-start', 'Comenzar repaso (' + dueResult.all.length + ' tarjetas)')
      btnStart.addEventListener('click', function () {
        var result = computeDue()
        if (result.all.length === 0) return

        shuffle(result.all)
        transitionTo(function () { showReview(cards, result.all, false) })
      })
      app.appendChild(btnStart)
    }

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

    // Forecast section
    var forecast = getForecast(cards)
    var forecastEl = el('div', 'forecast')
    forecastEl.setAttribute('aria-label', 'Prevision de repasos')
    forecastEl.innerHTML =
      '<div class="forecast-title">Prevision</div>' +
      '<div class="forecast-items">' +
        '<div class="forecast-item"><span class="forecast-num">' + forecast.d1 + '</span><span class="forecast-label">manana</span></div>' +
        '<div class="forecast-item"><span class="forecast-num">' + forecast.d3 + '</span><span class="forecast-label">3 dias</span></div>' +
        '<div class="forecast-item"><span class="forecast-num">' + forecast.d7 + '</span><span class="forecast-label">7 dias</span></div>' +
      '</div>'
    app.appendChild(forecastEl)

    // Action buttons row
    var actions = el('div', 'home-actions')

    var btnCram = el('button', 'btn-update', 'Modo libre')
    btnCram.setAttribute('aria-label', 'Modo libre: repasar sin calendario')
    btnCram.addEventListener('click', function () {
      transitionTo(function () { showCramSetup(cards) })
    })
    actions.appendChild(btnCram)

    var btnSearch = el('button', 'btn-update', 'Buscar')
    btnSearch.setAttribute('aria-label', 'Buscar tarjetas')
    btnSearch.addEventListener('click', function () { transitionTo(function () { showSearch(cards) }) })
    actions.appendChild(btnSearch)

    var btnStats = el('button', 'btn-update', 'Estadisticas')
    btnStats.setAttribute('aria-label', 'Ver estadisticas')
    btnStats.addEventListener('click', function () { transitionTo(function () { showStatistics(cards) }) })
    actions.appendChild(btnStats)

    var btnSettings = el('button', 'btn-update', 'Ajustes')
    btnSettings.setAttribute('aria-label', 'Abrir ajustes')
    btnSettings.addEventListener('click', function () { transitionTo(function () { showSettings(cards) }) })
    actions.appendChild(btnSettings)

    app.appendChild(actions)

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

    // Export/Import
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

    // PWA Install banner
    if (deferredInstallPrompt) {
      var installBanner = el('div', 'install-banner')
      installBanner.innerHTML =
        '<div class="install-text"><strong>Instalar app</strong><span>Accede mas rapido desde tu pantalla de inicio</span></div>'
      var btnInstall = el('button', 'btn-start', 'Instalar')
      btnInstall.style.width = 'auto'
      btnInstall.style.padding = '10px 24px'
      btnInstall.style.fontSize = '14px'
      btnInstall.addEventListener('click', function () {
        deferredInstallPrompt.prompt()
        deferredInstallPrompt.userChoice.then(function () {
          deferredInstallPrompt = null
          installBanner.remove()
        })
      })
      var btnDismiss = el('button', 'install-dismiss', '\u00D7')
      btnDismiss.setAttribute('aria-label', 'Cerrar banner de instalacion')
      btnDismiss.addEventListener('click', function () { installBanner.remove() })
      installBanner.appendChild(btnInstall)
      installBanner.appendChild(btnDismiss)
      app.appendChild(installBanner)
    }

    // Fire notification if due cards exist
    if (dueResult.all.length > 0) {
      showDueNotification(dueResult.all.length)
    }
  }

  // ── Search Screen (Feature 7) ──
  function showSearch(cards) {
    app.innerHTML = ''

    var header = el('div', 'header')
    header.innerHTML = '<h1>Buscar tarjetas</h1>'
    app.appendChild(header)

    var searchContainer = el('div', 'search-container')
    var searchIcon = el('span', 'search-icon', '\uD83D\uDD0D')
    var searchInput = el('input', 'search-input')
    searchInput.type = 'text'
    searchInput.placeholder = 'Buscar por texto, comando, tema...'
    searchInput.setAttribute('autocomplete', 'off')
    searchContainer.appendChild(searchIcon)
    searchContainer.appendChild(searchInput)
    app.appendChild(searchContainer)

    var countEl = el('div', 'search-count')
    app.appendChild(countEl)

    var resultsEl = el('div', 'search-results')
    app.appendChild(resultsEl)

    var detailEl = el('div', 'search-detail')
    detailEl.style.display = 'none'
    app.appendChild(detailEl)

    var btnBack = el('button', 'btn-secondary', 'Volver')
    btnBack.addEventListener('click', function () {
      transitionTo(function () {
        loadCards(false).then(function (c) { showHome(c) }).catch(function () { showHome(cards) })
      })
    })
    app.appendChild(btnBack)

    function doSearch() {
      var q = searchInput.value.trim().toLowerCase()
      detailEl.style.display = 'none'
      resultsEl.innerHTML = ''

      if (q.length < 2) {
        countEl.textContent = 'Escribe al menos 2 caracteres'
        return
      }

      var matches = cards.filter(function (c) {
        return c.q.toLowerCase().indexOf(q) !== -1 ||
               c.a.toLowerCase().indexOf(q) !== -1 ||
               c.subtema.toLowerCase().indexOf(q) !== -1
      })

      countEl.textContent = matches.length + ' resultado' + (matches.length !== 1 ? 's' : '')

      var shown = matches.slice(0, 50)
      shown.forEach(function (c) {
        var card = el('div', 'search-result-card')
        card.innerHTML =
          '<div class="search-result-q">' + escapeHtml(c.q) + '</div>' +
          '<div class="search-result-meta">' + c.cert.toUpperCase() + ' &middot; ' + c.subtema + '</div>'
        card.addEventListener('click', function () {
          detailEl.style.display = ''
          detailEl.innerHTML =
            '<div class="card-label">Pregunta</div>' +
            '<div class="card-text">' + formatCardText(c.q) + '</div>' +
            '<hr>' +
            '<div class="card-label">Respuesta</div>' +
            '<div class="card-text">' + formatCardText(c.a) + '</div>' +
            '<div class="card-meta">' + c.cert.toUpperCase() + ' &middot; ' + c.subtema + '</div>'
          detailEl.scrollIntoView({ behavior: 'smooth' })
        })
        resultsEl.appendChild(card)
      })

      if (matches.length > 50) {
        countEl.textContent += ' (mostrando primeros 50)'
      }
    }

    var searchTimer = null
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(doSearch, 200)
    })

    searchInput.focus()
  }

  // ── Cram Mode Setup ──
  function showCramSetup(cards) {
    app.innerHTML = ''

    var header = el('div', 'header')
    header.innerHTML = '<h1>Modo libre</h1><div class="subtitle">Repasa sin respetar el calendario SM-2</div>'
    app.appendChild(header)

    var activeCert = null

    // Cert filter pills
    var pills = el('div', 'cert-pills')
    var certKeys = ['lpic-1', 'lpic-2', 'lpic-3']
    var allCerts = [{ key: null, label: 'Todas' }]
    certKeys.forEach(function (k) {
      allCerts.push({ key: k, label: k.toUpperCase() })
    })

    var pillEls = []

    function getFiltered() {
      if (!activeCert) return cards.slice()
      return cards.filter(function (c) { return c.cert === activeCert })
    }

    allCerts.forEach(function (cert) {
      var subset = cert.key ? cards.filter(function (c) { return c.cert === cert.key }) : cards
      var pill = el('button', 'cert-pill' + (cert.key === null ? ' active' : ''))
      pill.innerHTML = cert.label + '<span class="count">' + subset.length + '</span>'
      pill.addEventListener('click', function () {
        activeCert = cert.key
        pillEls.forEach(function (p) { p.classList.remove('active') })
        pill.classList.add('active')
        countEl.textContent = getFiltered().length + ' tarjetas disponibles'
        btnGo.textContent = 'Empezar (' + getFiltered().length + ')'
      })
      pills.appendChild(pill)
      pillEls.push(pill)
    })
    app.appendChild(pills)

    var countEl = el('div', 'due-label')
    countEl.textContent = cards.length + ' tarjetas disponibles'
    app.appendChild(countEl)

    // Limit input
    var limitRow = el('div', 'setting-row')
    limitRow.style.maxWidth = '320px'
    limitRow.style.margin = '0 auto 24px'
    var limitLeft = el('div')
    limitLeft.innerHTML = '<div class="setting-label">Cantidad</div><div class="setting-desc">Tarjetas a repasar</div>'
    var limitInput = el('input', 'setting-input')
    limitInput.type = 'number'
    limitInput.min = '1'
    limitInput.max = '500'
    limitInput.value = '50'
    limitRow.appendChild(limitLeft)
    limitRow.appendChild(limitInput)
    app.appendChild(limitRow)

    var btnGo = el('button', 'btn-start', 'Empezar (' + cards.length + ')')
    btnGo.addEventListener('click', function () {
      var pool = getFiltered()
      var limit = parseInt(limitInput.value) || 50
      if (limit < 1) limit = 1
      shuffle(pool)
      var selected = pool.slice(0, limit)
      showReview(cards, selected, true) // true = cram mode
    })
    app.appendChild(btnGo)

    var btnBack = el('button', 'btn-secondary', 'Volver')
    btnBack.style.marginTop = '16px'
    btnBack.addEventListener('click', function () { transitionTo(function () { showHome(cards) }) })
    app.appendChild(btnBack)
  }

  // ── Settings Screen (Feature 8 + 3) ──
  function showSettings(cards) {
    app.innerHTML = ''

    var header = el('div', 'header')
    header.innerHTML = '<h1>Ajustes</h1>'
    app.appendChild(header)

    var container = el('div', 'settings-screen')
    var settings = getSettings()

    // Daily limit
    var limitRow = el('div', 'setting-row')
    var limitLeft = el('div')
    limitLeft.innerHTML = '<div class="setting-label">Tarjetas nuevas por dia</div><div class="setting-desc">Limite de tarjetas nuevas introducidas cada dia</div>'
    var limitInput = el('input', 'setting-input')
    limitInput.type = 'number'
    limitInput.min = '1'
    limitInput.max = '200'
    limitInput.value = settings.newCardsPerDay
    limitInput.addEventListener('change', function () {
      var val = parseInt(limitInput.value)
      if (isNaN(val) || val < 1) val = 1
      if (val > 200) val = 200
      limitInput.value = val
      settings.newCardsPerDay = val
      setSettings(settings)
    })
    limitRow.appendChild(limitLeft)
    limitRow.appendChild(limitInput)
    container.appendChild(limitRow)

    // Notifications toggle
    var notifRow = el('div', 'setting-row')
    var notifLeft = el('div')
    notifLeft.innerHTML = '<div class="setting-label">Notificaciones</div><div class="setting-desc">Recordatorio al abrir la app con tarjetas pendientes</div>'
    var notifToggle = el('button', 'setting-toggle' + (settings.notifications ? ' active' : ''))
    notifToggle.addEventListener('click', function () {
      if (!settings.notifications) {
        // Enabling: request permission first
        requestNotificationPermission(function (granted) {
          if (granted) {
            settings.notifications = true
            setSettings(settings)
            notifToggle.classList.add('active')
          } else {
            alert('Permiso de notificaciones denegado. Activalo en los ajustes del navegador.')
          }
        })
      } else {
        settings.notifications = false
        setSettings(settings)
        notifToggle.classList.remove('active')
      }
    })
    notifRow.appendChild(notifLeft)
    notifRow.appendChild(notifToggle)
    container.appendChild(notifRow)

    // Theme info
    var themeRow = el('div', 'setting-row')
    var themeLeft = el('div')
    themeLeft.innerHTML = '<div class="setting-label">Tema</div><div class="setting-desc">Usa el icono en la esquina superior derecha para cambiar</div>'
    var themeIndicator = el('span', '', getTheme() === 'dark' ? 'Oscuro' : 'Claro')
    themeIndicator.style.color = 'var(--text-dim)'
    themeIndicator.style.fontSize = '14px'
    themeRow.appendChild(themeLeft)
    themeRow.appendChild(themeIndicator)
    container.appendChild(themeRow)

    // Reset progress
    var resetRow = el('div', 'setting-row setting-row-danger')
    var resetLeft = el('div')
    resetLeft.innerHTML = '<div class="setting-label">Empezar de cero</div><div class="setting-desc">Borra todo el progreso SM-2, estadisticas y ajustes</div>'
    var btnReset = el('button', 'btn-danger', 'Reiniciar')
    btnReset.addEventListener('click', function () {
      if (!confirm('¿Seguro que quieres borrar TODO el progreso? Esta accion no se puede deshacer.')) return
      // Remove all lpic-study: keys from localStorage
      var keysToRemove = []
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i)
        if (key.indexOf(LS_PREFIX) === 0) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(function (k) { localStorage.removeItem(k) })
      // Re-apply default theme
      applyTheme('dark')
      // Reload cards and show onboarding
      loadCards(true).then(function (newCards) {
        showOnboarding(newCards)
      }).catch(function () {
        showHome(cards)
      })
    })
    resetRow.appendChild(resetLeft)
    resetRow.appendChild(btnReset)
    container.appendChild(resetRow)

    app.appendChild(container)

    // Back button
    var btnBack = el('button', 'btn-secondary', 'Volver')
    btnBack.style.marginTop = '24px'
    btnBack.addEventListener('click', function () {
      transitionTo(function () {
        loadCards(false).then(function (c) { showHome(c) }).catch(function () { showHome(cards) })
      })
    })
    app.appendChild(btnBack)
  }

  // ── Statistics Screen ──
  function showStatistics(cards) {
    app.innerHTML = ''

    var header = el('div', 'header')
    header.innerHTML = '<h1>Estadisticas</h1>'
    app.appendChild(header)

    var container = el('div', 'stats-screen')

    // Today stats
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

    // Activity heatmap (last 12 weeks)
    var heatSection = el('div', 'stats-section')
    heatSection.innerHTML = '<h3>Actividad (12 semanas)</h3>'
    var heatGrid = el('div', 'heatmap')

    // Build 12 weeks (84 days) of data
    var heatDays = []
    for (var hi = 83; hi >= 0; hi--) {
      heatDays.push(addDays(new Date(), -hi))
    }

    var heatMax = 0
    heatDays.forEach(function (day) {
      var d = dailyStats[day]
      if (d && d.reviewed > heatMax) heatMax = d.reviewed
    })

    // Day-of-week labels
    var dayLabels = ['L', '', 'X', '', 'V', '', 'D']
    var labelCol = el('div', 'heatmap-labels')
    dayLabels.forEach(function (l) {
      var lbl = el('div', 'heatmap-day-label', l)
      labelCol.appendChild(lbl)
    })
    heatGrid.appendChild(labelCol)

    // Group days into weeks (columns)
    // First, figure out what day of week the first day is (Monday = 0)
    var firstDate = new Date(heatDays[0])
    var firstDow = (firstDate.getDay() + 6) % 7 // 0=Mon

    // Create week columns
    var weekCol = el('div', 'heatmap-col')
    // Pad the first week with empty cells
    for (var pad = 0; pad < firstDow; pad++) {
      weekCol.appendChild(el('div', 'heatmap-cell empty'))
    }
    var cellInWeek = firstDow

    heatDays.forEach(function (day) {
      if (cellInWeek >= 7) {
        heatGrid.appendChild(weekCol)
        weekCol = el('div', 'heatmap-col')
        cellInWeek = 0
      }
      var d = dailyStats[day] || { reviewed: 0 }
      var cell = el('div', 'heatmap-cell')
      var level = 0
      if (d.reviewed > 0 && heatMax > 0) {
        var ratio = d.reviewed / heatMax
        if (ratio <= 0.25) level = 1
        else if (ratio <= 0.5) level = 2
        else if (ratio <= 0.75) level = 3
        else level = 4
      }
      cell.setAttribute('data-level', level)
      cell.title = day + ': ' + d.reviewed + ' tarjetas'
      weekCol.appendChild(cell)
      cellInWeek++
    })
    if (cellInWeek > 0) heatGrid.appendChild(weekCol)

    heatSection.appendChild(heatGrid)

    // Heatmap legend
    var heatLegend = el('div', 'heatmap-legend')
    heatLegend.innerHTML =
      '<span>Menos</span>' +
      '<div class="heatmap-cell" data-level="0"></div>' +
      '<div class="heatmap-cell" data-level="1"></div>' +
      '<div class="heatmap-cell" data-level="2"></div>' +
      '<div class="heatmap-cell" data-level="3"></div>' +
      '<div class="heatmap-cell" data-level="4"></div>' +
      '<span>Mas</span>'
    heatSection.appendChild(heatLegend)
    container.appendChild(heatSection)

    // Forecast in stats
    var fcast = getForecast(cards)
    var forecastSection = el('div', 'stats-section')
    forecastSection.innerHTML =
      '<h3>Prevision de repasos</h3>' +
      '<div class="forecast-items" style="justify-content:flex-start;gap:24px;">' +
        '<div class="forecast-item"><span class="forecast-num">' + fcast.d1 + '</span><span class="forecast-label">manana</span></div>' +
        '<div class="forecast-item"><span class="forecast-num">' + fcast.d3 + '</span><span class="forecast-label">3 dias</span></div>' +
        '<div class="forecast-item"><span class="forecast-num">' + fcast.d7 + '</span><span class="forecast-label">7 dias</span></div>' +
      '</div>'
    container.appendChild(forecastSection)

    // Last 7 days bar chart
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

    // Maturity
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

    // Per certification
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

    var btnBack = el('button', 'btn-secondary', 'Volver')
    btnBack.style.marginTop = '24px'
    btnBack.addEventListener('click', function () {
      transitionTo(function () {
        loadCards(false).then(function (c) { showHome(c) }).catch(function () { showHome(cards) })
      })
    })
    app.appendChild(btnBack)
  }

  // ── Review Screen ──
  function showReview(allCards, dueCards, cramMode) {
    app.innerHTML = ''
    var idx = 0
    var isFlipped = false
    var results = [] // { id, quality }
    var ratingInProgress = false
    var sessionStart = Date.now() // Feature 5: session timer

    // Undo state (Feature 4)
    var lastUndoState = null // { cardId, prevState, quality, resultIdx }

    // Header
    var reviewHeader = el('div', 'review-header')
    var progressText = el('div', 'review-progress-text')
    // Live score counter
    var scoreEl = el('div', 'review-score')
    var scoreRight = 0
    var scoreWrong = 0
    function updateScore() {
      scoreEl.innerHTML = '<span class="score-right">' + scoreRight + '</span> / <span class="score-wrong">' + scoreWrong + '</span>'
    }
    updateScore()

    var btnClose = el('button', 'btn-close', '\u00D7')
    btnClose.setAttribute('aria-label', 'Salir del repaso')
    function confirmExit() {
      var remaining = dueCards.length - idx
      if (remaining > 0 && idx > 0) {
        if (!confirm('Quedan ' + remaining + ' tarjetas. ¿Salir?')) return
      }
      showHome(allCards)
    }
    btnClose.addEventListener('click', confirmExit)
    reviewHeader.appendChild(progressText)
    reviewHeader.appendChild(scoreEl)
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

    // Interval toast
    var intervalToast = el('div', 'interval-toast')
    intervalToast.style.display = 'none'
    cardArea.appendChild(intervalToast)

    app.appendChild(cardArea)

    // Flip hint
    var flipHint = el('div', 'flip-hint', 'Toca la tarjeta o pulsa espacio para voltear')
    app.appendChild(flipHint)

    // Undo bar (Feature 4)
    var undoBar = el('div', 'undo-bar')
    var btnUndo = el('button', 'btn-undo', 'Deshacer')
    btnUndo.addEventListener('click', function () {
      if (!lastUndoState) return
      if (!cramMode) {
        // Restore previous SM-2 state
        lsSet(FC_PREFIX + lastUndoState.cardId, lastUndoState.prevState)
        // Revert daily stats
        revertDailyStats(lastUndoState.quality)
        // If was a new card, decrement new-today count
        if (lastUndoState.prevState.lastReview === null) {
          decrementNewToday()
        }
      }
      // Revert score counter
      if (lastUndoState.quality >= 3) scoreRight = Math.max(0, scoreRight - 1)
      else scoreWrong = Math.max(0, scoreWrong - 1)
      updateScore()
      // Remove from results
      results.splice(lastUndoState.resultIdx, 1)
      // Go back to previous card
      idx = lastUndoState.resultIdx
      lastUndoState = null
      btnUndo.classList.remove('visible')
      display()
    })
    undoBar.appendChild(btnUndo)
    app.appendChild(undoBar)

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
        showSummary(allCards, dueCards, results, sessionStart)
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

      // Difficulty indicator based on easeFactor
      var cardState = getCardState(c.id)
      var diffClass = 'diff-new'
      var diffLabel = 'Nueva'
      if (cardState.lastReview !== null) {
        if (cardState.easeFactor >= 2.2) {
          diffClass = 'diff-easy'
          diffLabel = 'Facil'
        } else if (cardState.easeFactor >= 1.8) {
          diffClass = 'diff-medium'
          diffLabel = 'Media'
        } else {
          diffClass = 'diff-hard'
          diffLabel = 'Dificil'
        }
      }
      var diffDot = '<span class="diff-dot ' + diffClass + '" title="' + diffLabel + '"></span>'

      front.innerHTML =
        '<div class="card-label">Pregunta ' + diffDot + '</div>' +
        '<div class="card-text">' + formatCardText(c.q) + '</div>' +
        '<div class="card-meta">' + c.subtema + '</div>'

      back.innerHTML =
        '<div class="card-label">Respuesta ' + diffDot + '</div>' +
        '<div class="card-text">' + formatCardText(c.a) + '</div>' +
        '<div class="card-meta">' + c.subtema + '</div>'

      var pct = dueCards.length > 0 ? Math.round((idx / dueCards.length) * 100) : 0
      progressFill.style.width = pct + '%'
      progressText.innerHTML = '<strong>' + (idx + 1) + '</strong> / ' + dueCards.length
    }

    var swipeHintShown = false
    function flipCard() {
      if (idx >= dueCards.length || isFlipped) return
      isFlipped = true
      vibrate(8)
      card.classList.add('flipped')
      ratingArea.classList.remove('hidden')
      flipHint.classList.add('hidden')

      // Show swipe hint on first flip only
      if (!swipeHintShown && 'ontouchstart' in window) {
        swipeHintShown = true
        var hint = el('div', 'swipe-hint')
        hint.innerHTML = '<span class="swipe-arrow swipe-arrow-left">&larr; Fallo</span><span class="swipe-arrow swipe-arrow-right">Acierto &rarr;</span>'
        cardArea.appendChild(hint)
        setTimeout(function () { hint.classList.add('fade-out') }, 2000)
        setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint) }, 2500)
      }
    }

    function rate(quality) {
      if (!isFlipped || ratingInProgress) return
      ratingInProgress = true
      vibrate(quality >= 3 ? [10] : [20, 30, 20])

      var c = dueCards[idx]

      // Save state before rating for undo
      var prevState = getCardState(c.id)
      prevState = JSON.parse(JSON.stringify(prevState))

      var newState
      if (cramMode) {
        // Cram mode: don't update SM-2 state
        newState = prevState
      } else {
        newState = rateCard(c.id, quality)
      }
      var resultIdx = results.length
      results.push({ id: c.id, quality: quality })

      // Update live score
      if (quality >= 3) scoreRight++
      else scoreWrong++
      updateScore()

      if (!cramMode) {
        updateDailyStats(quality)
        // Track new card introduction only when actually rated
        if (prevState.lastReview === null) {
          incrementNewToday()
        }
      }

      // Store undo state
      lastUndoState = {
        cardId: c.id,
        prevState: prevState,
        quality: quality,
        resultIdx: resultIdx
      }

      // Show undo briefly
      btnUndo.classList.add('visible')
      setTimeout(function () {
        // Hide undo after moving to next card (unless another undo replaces it)
        if (lastUndoState && lastUndoState.resultIdx === resultIdx) {
          // Keep visible until next rating or 5 seconds
        }
      }, 0)

      // Auto-hide undo after 5 seconds
      var undoTimeout = setTimeout(function () {
        if (lastUndoState && lastUndoState.resultIdx === resultIdx) {
          btnUndo.classList.remove('visible')
          lastUndoState = null
        }
      }, 5000)

      // Show interval toast
      var toastMsg = ''
      if (quality < 3) {
        toastMsg = 'Repetir ma\u00F1ana'
      } else {
        toastMsg = 'Proxima revision: en ' + newState.interval + ' dia' + (newState.interval !== 1 ? 's' : '')
      }
      intervalToast.textContent = toastMsg
      intervalToast.style.display = ''
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

    // Swipe gestures
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
          card.classList.add('card-swipe-right')
          card.classList.remove('card-swipe-left')
          rate(Q_RIGHT)
        } else {
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
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        // Ctrl+Z / Cmd+Z = undo
        e.preventDefault()
        if (lastUndoState) btnUndo.click()
      } else if (e.key === 'Escape') {
        confirmExit()
      }
    }

    document.addEventListener('keydown', onKey)

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
  function showSummary(allCards, dueCards, results, sessionStart) {
    app.innerHTML = ''

    var good = results.filter(function (r) { return r.quality >= 3 }).length
    var wrong = results.filter(function (r) { return r.quality < 3 }).length
    var elapsed = Date.now() - sessionStart

    var summary = el('div', 'summary')

    summary.innerHTML =
      '<h2>Sesion completada</h2>' +
      '<div class="session-time">Duracion: ' + formatDuration(elapsed) + '</div>' +
      '<div class="summary-stats">' +
        '<div class="summary-stat"><div class="summary-num green">' + good + '</div><div class="summary-label">Aciertos</div></div>' +
        '<div class="summary-stat"><div class="summary-num red">' + wrong + '</div><div class="summary-label">Fallos</div></div>' +
        '<div class="summary-stat"><div class="summary-num">' + results.length + '</div><div class="summary-label">Total</div></div>' +
      '</div>'

    app.appendChild(summary)

    // Confetti if accuracy > 80%
    var accuracy = results.length > 0 ? (good / results.length) * 100 : 0
    if (accuracy >= 80 && results.length >= 3) {
      launchConfetti()
    }

    var actions = el('div', 'summary-actions')
    summary.appendChild(actions)

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
    applyTheme(getTheme())
    showLoading()

    loadCards(false)
      .then(function (cards) {
        // Check onboarding (Feature 6)
        if (!lsGet(ONBOARDING_KEY)) {
          showOnboarding(cards)
        } else {
          showHome(cards)
        }
      })
      .catch(function (err) {
        showError(err.message)
      })
  }

  init()
})()
