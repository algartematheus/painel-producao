// Nome do cache para o nosso aplicativo
const CACHE_NAME = 'painel-producao-cache-v1';

// No evento 'activate', limpamos caches antigos para garantir que estamos usando a versão mais recente.
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cacheName => cacheName !== CACHE_NAME)
                          .map(cacheName => caches.delete(cacheName))
            );
        })
    );
});

// No evento 'fetch', interceptamos os pedidos de rede.
self.addEventListener('fetch', event => {
    event.respondWith(
        // Primeiro, tentamos buscar o recurso da internet (network).
        fetch(event.request).then(networkResponse => {
            // Se conseguirmos, guardamos uma cópia no cache e retornamos a resposta da internet.
            return caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
            });
        }).catch(() => {
            // Se a busca na internet falhar (provavelmente porque estamos offline),
            // tentamos obter o recurso do nosso cache.
            return caches.match(event.request);
        })
    );
});
