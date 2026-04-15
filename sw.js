/* ============================================================
   NEUROAUTH — Service Worker v3.2
   Estratégia: Network-first (index.html) + Cache-fallback (assets)
   Otimizado para ambiente hospitalar (internet instável)
   ============================================================ */

'use strict';

const APP_VERSION = 'neuroauth-v3.7';
const CACHE_NAME  = APP_VERSION + '-cache';

/* Recursos do app shell a pré-cachear no install */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* Arquivos que devem SEMPRE buscar da rede primeiro */
const NETWORK_FIRST = ['index.html', '/'];

/* ──────────────────────────────────────────────
   INSTALL — pré-cache do app shell
────────────────────────────────────────────── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW v3.2] Instalando e cacheando app shell');
      return cache.addAll(APP_SHELL);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* ──────────────────────────────────────────────
   ACTIVATE — limpa TODOS os caches anteriores
────────────────────────────────────────────── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) {
            console.log('[SW v3.2] Removendo cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* ──────────────────────────────────────────────
   FETCH — Network-first para index.html,
           Cache-fallback para assets estáticos
────────────────────────────────────────────── */
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  /* Requisições externas → bypass completo */
  if (url.origin !== self.location.origin) {
    return;
  }

  /* index.html e root → NETWORK-FIRST (sempre busca versão nova) */
  var isNetworkFirst = NETWORK_FIRST.some(function(path) {
    return url.pathname.endsWith(path) || url.pathname === '/' || url.pathname === '';
  });

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        /* Offline: serve do cache como fallback */
        return caches.match(event.request);
      })
    );
    return;
  }

  /* Assets estáticos (imagens, manifest) → Cache-first */
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
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
