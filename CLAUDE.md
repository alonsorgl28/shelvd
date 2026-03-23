# Shelvd — Project CLAUDE.md

## Qué es Shelvd
App web PWA para catalogar tu biblioteca personal. Tomas foto de la portada, se identifica el libro automáticamente, y se apila en un shelf 3D interactivo. Cada usuario tiene un perfil público (`/@username`).

## Stack
- **Frontend:** HTML/CSS/JS vanilla (sin frameworks)
- **Backend:** Supabase (auth + DB + edge functions)
- **Hosting:** Vercel (static + rewrites)
- **PWA:** manifest.json + sw.js + pwa-install.js

## Archivos clave
| Archivo | Responsabilidad |
|---------|----------------|
| `index.html` | App principal (login, shelf, grid) |
| `landing.html` | Landing page marketing |
| `style.css` | Todos los estilos de la app |
| `app.js` | Lógica del shelf 3D, renderizado de libros |
| `auth.js` | Login (Google OAuth + magic link), upload de fotos |
| `pwa-install.js` | Banner de instalación PWA (Android + iOS) |
| `sw.js` | Service worker (cache `shelvd-v3`) |
| `import-export.js` | Import/export de biblioteca |
| `vercel.json` | Rewrites (`/@:username` → index.html) |
| `manifest.json` | Config PWA |

## Reglas críticas
- **NO tocar `loadBooksData()` en app.js** — maneja la carga de libros y es frágil
- **Dominio Vercel:** `shelvd-mu.vercel.app` (no `shelvd.vercel.app`)
- **CORS portadas:** Usar Open Library primero (tiene CORS), no Google Books directo
- **Vercel routing:** Solo `cleanUrls: true` + rewrite `/@:username`. NO catch-all rewrites o rompe archivos estáticos

## Brand
- **Tipografía:** Helvetica Neue, weight 500, letter-spacing -0.04em
- **Logo:** Texto "**S**helvd" (S bold) — SIN iconos SVG de libros. Nunca agregar gráficos al logo.
- **Logo archivos:** `/Users/hola/Library/Mobile Documents/iCloud~md~obsidian/Documents/ALPHA/Shelvd-brand/`
- **Colores app:** Navy oscuro `#141a2e` fondo, estrellas animadas
- **Landing:** Fondo blanco, texto negro, showcase oscuro como contraste

## Gotchas
- Service worker cache: bumpar versión en `sw.js` cuando cambias assets estáticos
- Landing page es un archivo separado (`landing.html`), no parte del SPA
- Los libros en el SVG de la brand section usan colores oscuros (`#222`, `#333`) porque el fondo de la landing es blanco
