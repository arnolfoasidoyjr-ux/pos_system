// ═══════════════════════════════════════════════════════════════════════════
// POS SERVICE WORKER — FULL OFFLINE PWA ENGINE (v17)
// Caches complete application shell, UI, icons, scripts & assets so the POS
// works seamlessly with 100% functionality even when offline/no-network.
// ═══════════════════════════════════════════════════════════════════════════

const SHELL = 'pos-shell-v18';
const IMGS = 'pos-img-v3';
const IMG_LIMIT = 500;
const BASE = new URL('./', self.location).href;
const APP_SHELL_KEY = new URL('./?page=dashboard', self.location).href;

const PRECACHE_ASSETS = [
    new URL('./', BASE).href,
    new URL('index.php', BASE).href,
    new URL('index.php?page=dashboard', BASE).href,
    new URL('manifest.json', BASE).href,
    new URL('manifest.webmanifest', BASE).href,
    new URL('assets/icon-192.png', BASE).href,
    new URL('assets/icon-512.png', BASE).href,
    new URL('assets/icon-192-maskable.png', BASE).href,
    new URL('assets/icon-512-maskable.png', BASE).href,
    new URL('assets/default-logo.png', BASE).href,
    new URL('assets/default-product.png', BASE).href,
    'https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js',
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
    'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/qz-tray@2.2.6/qz-tray.js'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(SHELL).then(async cache => {
            for (const url of PRECACHE_ASSETS) {
                try {
                    await cache.add(url);
                } catch (err) {
                    // Continue caching other assets even if an individual remote URL fails
                }
            }
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMGS).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', e => {
    if (e.data === 'skipWaiting') {
        self.skipWaiting();
    }
    if (e.data === 'clearUserCache') {
        caches.delete(SHELL);
    }
});

function isImageRequest(url, req) {
    if (req.method !== 'GET') return false;
    if (url.pathname.includes('get_product_image')) return true;
    if (url.pathname.includes('/assets/') && (url.pathname.endsWith('.png') || url.pathname.endsWith('.webp') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.svg'))) return true;
    if (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/public/')) return true;
    if (url.hostname.endsWith('.cloudinary.com') && url.pathname.includes('/image/upload/')) return true;
    return false;
}

async function trimCache(cacheName, max) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        while (keys.length > max) {
            await cache.delete(keys[0]);
            keys.shift();
        }
    } catch (e) {}
}

// Quick fetch with timeout to avoid freezing offline or on weak signal
async function fetchWithTimeout(request, timeoutMs = 3000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const response = await fetch(request, { signal: ctrl.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

self.addEventListener('fetch', e => {
    const req = e.request;
    const url = new URL(req.url);

    // State-changing calls (form POSTs, login, logout) bypass SW if online
    if (req.method !== 'GET') {
        return;
    }

    // Dynamic API requests (?api=...) - fast timeout failover so client IndexedDB answers instantly
    if (url.searchParams.has('api')) {
        e.respondWith(
            fetchWithTimeout(req, 2800).catch(() => {
                return new Response(JSON.stringify({ success: false, offline: true, error: 'Offline - server unreachable' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // ── IMAGES: Cache-first (instant after first view, works offline) ──
    if (isImageRequest(url, req)) {
        e.respondWith((async () => {
            const cache = await caches.open(IMGS);
            const hit = await cache.match(req);
            if (hit) return hit;
            try {
                const resp = await fetch(req);
                if (resp && (resp.status === 200 || resp.type === 'opaque')) {
                    await cache.put(req, resp.clone());
                    trimCache(IMGS, IMG_LIMIT);
                }
                return resp;
            } catch (err) {
                // If offline and image not cached, fallback to default product or logo
                const defProd = await cache.match(new URL('assets/default-product.png', BASE).href);
                if (defProd) return defProd;
                return Response.error();
            }
        })());
        return;
    }

    // ── APP HTML NAVIGATION: Network-first with quick 2.5s timeout, cached full SPA shell fallback ──
    if (req.mode === 'navigate') {
        e.respondWith((async () => {
            const shellCache = await caches.open(SHELL);
            try {
                // Try live network request first with quick timeout
                const resp = await fetchWithTimeout(req, 2500);
                if (resp && resp.status === 200) {
                    await shellCache.put(APP_SHELL_KEY, resp.clone());
                    await shellCache.put(req, resp.clone());
                }
                return resp;
            } catch (err) {
                // Offline / timeout: serve the full cached POS app shell!
                const cachedPage = await shellCache.match(req);
                if (cachedPage) return cachedPage;

                const cachedShell = await shellCache.match(APP_SHELL_KEY);
                if (cachedShell) return cachedShell;

                const cachedRoot = await shellCache.match(new URL('index.php', BASE).href) || await shellCache.match(new URL('./', BASE).href);
                if (cachedRoot) return cachedRoot;

                // Fallback minimal offline notice only if the app was NEVER opened once
                return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — ProCast</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a1628;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center;}
.box{background:#112240;padding:36px 24px;border-radius:16px;max-width:440px;width:100%;border:1.5px solid rgba(255,255,255,0.1);}
h1{font-size:1.35rem;margin:0 0 10px;color:#38bdf8;}
p{color:#94a3b8;font-size:0.92rem;line-height:1.5;margin-bottom:24px;}
.btn{display:block;width:100%;padding:12px;border-radius:10px;font-weight:700;font-size:.95rem;cursor:pointer;border:none;background:#2563eb;color:#fff;}
</style>
</head>
<body>
<div class="box">
<h1>Initial Setup Needed</h1>
<p>Please connect to the internet or start your local server once so the POS can store its offline files on this device.</p>
<button class="btn" onclick="location.reload()">Retry Connection</button>
</div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
        })());
        return;
    }

    // ── CDN LIBRARIES & STATIC FILES: Cache-first, network fallback ──
    e.respondWith((async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
            const resp = await fetch(req);
            if (resp && (resp.status === 200 || resp.type === 'opaque')) {
                await cache.put(req, resp.clone());
            }
            return resp;
        } catch (err) {
            return hit || Response.error();
        }
    })());
});

// ── BACKGROUND SYNC: Wake up and signal clients when connection is restored ──
self.addEventListener('sync', e => {
    if (e.tag === 'sync-offline-orders' || e.tag === 'pos-sync') {
        e.waitUntil(
            self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'TRIGGER_SYNC' });
                });
            })
        );
    }
});

