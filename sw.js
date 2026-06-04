const CACHE_VERSION = 'v6'
const CACHE_NAME = 'pingunix-cards-' + CACHE_VERSION
const DATA_CACHE = 'pingunix-cards-data-' + CACHE_VERSION

const PRECACHE = [
  '/pingunix-cards/',
  '/pingunix-cards/index.html',
  '/pingunix-cards/app.js',
  '/pingunix-cards/styles.css',
  '/pingunix-cards/icon-192.png',
  '/pingunix-cards/manifest.json',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('pingunix-cards-') && k !== CACHE_NAME && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // Flashcard JSON: network-first, cache as fallback
  if (url.pathname.endsWith('flashcards-all.json')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone()
          caches.open(DATA_CACHE).then((c) => c.put(e.request, clone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // Local assets: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached
        return fetch(e.request).then((res) => {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone))
          return res
        })
      })
    )
    return
  }

  // Everything else: network only
  e.respondWith(fetch(e.request))
})
