// Define um nome e uma versão para o cache
const CACHE_NAME = 'painel-producao-cache-v1';
// Lista de URLs para fazer cache inicial (arquivos estáticos essenciais)
const urlsToCache = [
  '/',
  '/index.html',
  // Adicione aqui outros arquivos estáticos importantes, como ícones ou logos, se houver
];

// Evento de instalação: abre o cache e adiciona os arquivos da lista
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Evento de busca (fetch): intercepta as requisições
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignora requisições que não são do tipo GET (ex: POST para o Firebase)
  if (request.method !== 'GET') {
    return;
  }

  // Ignora requisições de extensões do Chrome
  if (request.url.startsWith('chrome-extension://')) {
    return;
  }
  
  // Ignora requisições para a API do Firebase
  if (request.url.includes('firestore.googleapis.com')) {
      return;
  }

  event.respondWith(
    // Tenta encontrar a resposta no cache
    caches.match(request)
      .then(response => {
        // Se encontrar no cache, retorna a resposta do cache
        if (response) {
          return response;
        }

        // Se não encontrar, faz a requisição à rede
        return fetch(request).then(
          networkResponse => {
            // Verifica se a resposta da rede é válida
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clona a resposta para poder retorná-la e também salvá-la no cache
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(request, responseToCache);
              });

            return networkResponse;
          }
        );
      })
      .catch(() => {
        // Se tudo falhar (cache e rede), você pode retornar uma página de fallback offline
        // Por exemplo: return caches.match('/offline.html');
      })
  );
});

// Evento de ativação: limpa caches antigos
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

