const CACHE_NAME = 'shelvd-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/auth.js',
    '/app.js',
    '/pwa-install.js',
    '/books.json'
];

// Install — cache static assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (e) => {
    // Skip non-GET and API/auth requests
    if (e.request.method !== 'GET' || e.request.url.includes('supabase') || e.request.url.includes('googleapis')) {
        return;
    }

    e.respondWith(
        fetch(e.request)
            .then(resp => {
                // Cache successful responses
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return resp;
            })
            .catch(() => caches.match(e.request))
    );
});
