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
├── sw.js ─────────── Service worker cache v3
└── vercel.json ───── Rewrites (/@:username)

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
| Perfil público | ✅ Done | /@username rewrite |
| PWA install | ✅ Done | Android banner + iOS sheet |
| Landing page | ✅ Done | Hero, brand animation, features, showcase |
| Import/Export | ✅ Done | JSON export/import |

## 4. Landing page (landing.html)
- **Hero:** "Your books, beautifully stacked." + botones con starfield canvas
- **Brand section:** Torre SVG de 12 libros que caen con física (scroll-triggered)
- **Features:** 3 cards animadas (Snap a cover, Build your shelf, Share your library)
- **Showcase:** Auto-scroll de 24 lomos reales sobre fondo navy con estrellas
- **Stats + CTA + Footer**
- **Tema:** Fondo blanco, texto negro (excepto showcase = navy oscuro)

## 5. Estado actual
- Landing page completa con animaciones interactivas
- Logo oficial (5 bars + Shelvd) integrado en app y landing
- Tipografía unificada: Helvetica Neue 500, -0.04em
- Tema de landing invertido a blanco

## 6. Problemas conocidos
- Open Library covers pueden tardar en cargar (fallback necesario)
- Service worker necesita bump manual de versión
- `loadBooksData()` en app.js es frágil — no modificar
