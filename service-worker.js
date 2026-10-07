/* ==========================================================
   Inforteca Premiada — Service Worker
   ========================================================== */

const CACHE_NAME = 'inforteca-v2';
const OFFLINE_URLS = [
  '/premiada.html',
  '/sidebar.js',
  '/manifest.json',
];

/* ----------------------------------------
   INSTALL — cacheia app shell
   ---------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS).catch((e) => {
        console.warn('[SW] Falha ao cachear:', e);
      });
    })
  );
  self.skipWaiting();
});

/* ----------------------------------------
   ACTIVATE — limpa caches antigos
   ---------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ----------------------------------------
   FETCH — network-first com fallback pro cache
   ---------------------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignora requests de API/Supabase (sempre rede)
  if (req.url.includes('supabase.co')) return;
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cacheia cópia da resposta (só same-origin)
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match('/premiada.html')))
  );
});

/* ----------------------------------------
   PUSH — recebe notificação do servidor
   ---------------------------------------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Inforteca Premiada', body: event.data?.text() || '' };
  }

  const title = data.title || 'Inforteca Premiada';
  const options = {
    body: data.body || 'Você tem uma novidade!',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    vibrate: data.vibrate || [200, 100, 200],
    tag: data.tag || 'inforteca-' + Date.now(),
    renotify: true,
    requireInteraction: false,
    data: {
      url: data.url || '/premiada.html',
      tipo: data.tipo || 'geral',
    },
    actions: data.actions || [
      { action: 'abrir', title: 'Abrir' },
      { action: 'fechar', title: 'Fechar' },
    ],
  };

  // 🔴 Atualiza o badge no ícone do app
  const badgeCount = data.badge_count || 1;
  if ('setAppBadge' in self.registration) {
    self.registration.setAppBadge(badgeCount).catch((e) => {
      console.warn('[SW] Badge falhou:', e);
    });
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ----------------------------------------
   MESSAGE — recebe comandos da página
   ---------------------------------------- */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_BADGE') {
    if ('clearAppBadge' in self.registration) {
      self.registration.clearAppBadge().catch(() => {});
    }
  }
  if (event.data?.type === 'SET_BADGE') {
    if ('setAppBadge' in self.registration) {
      self.registration.setAppBadge(event.data.count || 0).catch(() => {});
    }
  }
});

/* ----------------------------------------
   CLICK — quando o usuário toca na notificação
   ---------------------------------------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'fechar') return;

  const url = event.notification.data?.url || '/premiada.html';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Se já tem uma aba aberta do sistema, foca nela
        for (const client of clientList) {
          if (client.url.includes('premiada') && 'focus' in client) {
            return client.focus();
          }
        }
        // Senão, abre uma nova
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});

/* ----------------------------------------
   PUSH SUBSCRIPTION CHANGE — renovação
   ---------------------------------------- */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription.options)
      .then((sub) => {
        // Avisa o app pra salvar a nova subscription
        return self.clients.matchAll().then((clients) => {
          clients.forEach((c) => c.postMessage({ type: 'PUSH_SUB_CHANGED', sub: sub.toJSON() }));
        });
      })
  );
});
