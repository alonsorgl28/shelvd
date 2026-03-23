# Shelvd — Compact Context

## 1. Qué es
App web PWA para catalogar y compartir tu biblioteca personal en 3D. Foto → identificación automática → shelf interactivo → perfil público.

## 2. Arquitectura
```
Vercel (static hosting)
├── landing.html ──── Marketing page (white theme, animations)
├── index.html ────── SPA app (dark theme, navy + stars)
│   ├── auth-screen ── Login (Google OAuth / magic link)
│   ├── shelf-view ─── 3D book stack (scroll vertical)
│   └── grid-view ──── Grid de portadas
├── style.css ─────── Estilos globales de la app
├── app.js ────────── Shelf 3D, renderizado, scroll, interacciones
├── auth.js ───────── Auth flow, upload fotos, enter library
├── pwa-install.js ── Install banner (Android/iOS)
├── analytics.js ──── Tracking mínimo de funnel
├── 404.html ──────── Fallback SPA (copia de index.html)
├── sw.js ─────────── Service worker cache v5
└── vercel.json ───── Rewrites (/@:username + catch-all)

Supabase
├── Auth (Google OAuth + magic link)
├── Database (books, users)
└── Edge Functions (analyze-book: foto → metadata)
```

## 3. Módulos clave
| Módulo | Estado | Notas |
|--------|--------|-------|
| Auth (Google + email) | ✅ Done | OAuth + magic link |
| Upload fotos | ✅ Done | HEIC→JPEG, spinner overlay |
| Shelf 3D | ✅ Done | Scroll, lomos con colores |
| Grid view | ✅ Done | Portadas en grid |
| Search | ✅ Done | Expandable bar, filtra grid/shelf |
| Perfil público | ✅ Done | /@username (404.html fallback + catch-all rewrite) |
| PWA install | ✅ Done | Android banner + iOS sheet |
| Landing page | ✅ Done | Hero, brand animation, features, showcase |
| Import/Export | ✅ Done | Excel/CSV import, Excel/Word export (SheetJS + FileSaver) |
| Scroll sound | ✅ Done | Wood knock via Web Audio API, scrollbar thumb only |
| Analytics | ✅ Done | Funnel events: landing, app, auth, book_added, share, profile |
| Share loop fix | ✅ Done | Public profile shows only user books, no demo data |

## 4. Landing page (landing.html)
- **Hero:** "Your books, beautifully stacked." + botones con starfield canvas
- **Brand section:** Torre SVG de 12 libros que caen con física (scroll-triggered)
- **Features:** 3 cards animadas (Snap a cover, Build your shelf, Share your library)
- **Showcase:** Auto-scroll de 24 lomos reales sobre fondo navy con estrellas
- **Stats + CTA + Footer**
- **Tema:** Fondo blanco, texto negro (excepto showcase = navy oscuro)

## 5. Video teaser (shelvd-teaser/)
Proyecto Remotion para video promocional. 1080x1920 vertical, 30fps, 300 frames (10 seg).
- **Escena 1 (0-90):** LogoScene3D — 5 barras crema 3D del logo con física de dispersión (replica shelvd-logo-motion.html). Hold → scatter → fade.
- **Escena 2 (85-300):** BookStack3D — 15 libros coloreados (generateBookColor) caen en cascada top-down con misma física. Spine textures canvas. Wordmark final.
- **Stack:** Remotion + @remotion/three + Three.js + React
- **Comandos:** `npm start` (studio :3123), `npm run build` (render MP4)

## 6. Estado actual (2026-03-23)
- Share loop /@username funcionando (404.html fallback + catch-all rewrite)
- Perfil público muestra solo libros del usuario (sin demo data)
- Analytics mínimos implementados (analytics.js)
- Video teaser Remotion con logo 3D + book cascade
- PWA icons: 4-bar book stack con degradado y sombras
- Landing page completa con animaciones interactivas

## 7. Problemas conocidos
- Open Library covers pueden tardar en cargar (fallback a Google Books)
- Service worker necesita bump manual de versión (`shelvd-v5`)
- `loadBooksData()` en app.js es frágil — no modificar
- Video teaser pendiente de revisión visual y render final
- Covers frágiles: dependen de APIs externas en cliente (Open Library/Google Books + localStorage)
- Uploads a Storage no optimizados (se sube blob original sin comprimir)
