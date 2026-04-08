/* ============================================================
   NEUROAUTH — Service Worker v2.7
   Estratégia: Cache-first (app shell) + Network-first (fetch)
   Otimizado para ambiente hospitalar (internet instável)
   ============================================================ */

'use strict';

const APP_VERSION = 'neuroauth-v2.7';
const CACHE_NAME  = APP_VERSION + '-cache';

/* Recursos do app shell a pré-cachear no install */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ──────────────────────────────────────────────
   INSTALL — pré-cache do app shell
────────────────────────────────────────────── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Instalando e cacheando app shell');
      return cache.addAll(APP_SHELL);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* ──────────────────────────────────────────────
   ACTIVATE — limpa caches de versões anteriores
────────────────────────────────────────────── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) {
            console.log('[SW] Removendo cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* ──────────────────────────────────────────────
   FETCH — Cache-first para app shell,
           Network-first para requisições externas
────────────────────────────────────────────── */
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  /* Requisições externas (webhook Make.com) → sempre network, sem cache */
  if (url.origin !== self.location.origin) {
    return; /* deixa o browser tratar normalmente */
  }

  /* App shell (mesmo origin) → Cache-first com fallback para network */
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        /* Cachado: serve imediatamente e atualiza em background */
        var networkFetch = fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() { /* offline — já servimos do cache */ });
        return cached;
      }
      /* Não cachado: busca na rede e guarda no cache */
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      });
    })
  );
});

/* ──────────────────────────────────────────────
   MESSAGE — suporte ao updateApp() da página
────────────────────────────────────────────── */
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
