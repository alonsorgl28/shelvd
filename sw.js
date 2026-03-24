const CACHE_NAME = 'shelvd-v21';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/auth.js',
    '/auth.js?v=20260324j',
    '/app.js',
    '/app.js?v=20260324j',
    '/pwa-install.js',
    '/pwa-install.js?v=20260324b',
    '/import-export.js',
    '/import-export.js?v=20260324j',
    '/analytics.js',
    '/analytics.js?v=20260324b',
    '/books.json',
    '/library-config.json',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.json'
];

const CDN_ASSETS = [
    'https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js',
    'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
    'https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js',
    'https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js',
    'https://unpkg.com/three@0.169.0/build/three.module.js',
    'https://unpkg.com/three@0.169.0/examples/jsm/controls/OrbitControls.js'
];

const OFFLINE_PAGE = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shelvd — Offline</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0a0f1a;color:rgba(255,255,255,0.6);font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center}
.logo{font-size:32px;font-weight:500;color:rgba(255,255,255,0.9);margin-bottom:12px;letter-spacing:-0.04em}
.logo span{font-weight:700}
p{font-size:14px;line-height:1.6;max-width:280px}
button{margin-top:20px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);
color:rgba(255,255,255,0.8);padding:10px 24px;border-radius:10px;font-size:14px;cursor:pointer}
</style></head><body><div>
<div class="logo"><span>S</span>helvd</div>
<p>You're offline. Connect to the internet to browse your library.</p>
<button onclick="location.reload()">Try again</button>
</div></body></html>`;

// Install — cache static + CDN assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await cache.addAll(STATIC_ASSETS);
            // CDN assets: best-effort (don't block install if one fails)
            await Promise.allSettled(CDN_ASSETS.map(url =>
                fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => null)
            ));
        }).then(() => self.skipWaiting())
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

// Fetch — network first, fallback to cache, then offline page
self.addEventListener('fetch', (e) => {
    // Skip non-GET and Supabase API/auth requests
    if (e.request.method !== 'GET' || e.request.url.includes('supabase') || e.request.url.includes('googleapis')) {
        return;
    }

    const requestUrl = new URL(e.request.url);
    if (
        requestUrl.pathname === '/ops' ||
        requestUrl.pathname.startsWith('/ops/') ||
        requestUrl.pathname === '/ops-preview' ||
        requestUrl.pathname.startsWith('/ops-preview/')
    ) {
        return;
    }

    // Cover images: cache-first (they rarely change)
    if (e.request.url.includes('covers.openlibrary.org') || e.request.url.includes('books.google.com')) {
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                return fetch(e.request).then(resp => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                    }
                    return resp;
                }).catch(() => new Response('', { status: 404 }));
            })
        );
        return;
    }

    // Everything else: network first
    e.respondWith(
        fetch(e.request)
            .then(resp => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return resp;
            })
            .catch(() =>
                caches.match(e.request).then(cached => {
                    if (cached) return cached;
                    // Navigation requests get the offline page
                    if (e.request.mode === 'navigate') {
                        return new Response(OFFLINE_PAGE, {
                            headers: { 'Content-Type': 'text/html' }
                        });
                    }
                    return new Response('', { status: 404 });
                })
            )
    );
});
