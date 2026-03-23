# Shelvd — Project Tracker

## Overall Progress
```
Fase 1: Core App         ████████████████████ 100%
Fase 2: UX Mobile        ████████████████████ 100%
Fase 3: PWA              ████████████████████ 100%
Fase 4: Landing Page     ████████████████████ 100%
Fase 5: Brand Identity   ████████████████████ 100%
Fase 6: Product Hardening ████████░░░░░░░░░░░░ 40%
Fase 7: Video Teaser     ██████████░░░░░░░░░░ 50%
```

## Fase 1: Core App
| Feature | Estado | Notas |
|---------|--------|-------|
| Auth (Google + email) | ✅ | OAuth + magic link via Supabase |
| Upload foto → metadata | ✅ | HEIC conversion, edge function |
| Shelf 3D | ✅ | Scroll vertical, lomos con colores |
| Grid view | ✅ | Portadas en grid layout |
| Perfil público | ✅ | /@username con Vercel rewrite |
| Search | ✅ | Expandable bar, filtra ambas vistas |
| Import/Export | ✅ | Excel/CSV import, Excel/Word export |
| Scroll sound | ✅ | Wood knock, scrollbar thumb only |
| Cover bug fixes | ✅ | sb- prefix, digital covers only, grid click fix |

## Fase 2: UX Mobile
| Feature | Estado | Notas |
|---------|--------|-------|
| Upload spinner | ✅ | Overlay en capture zone |
| Action bar animations | ✅ | Staggered entrance, squash & stretch |
| Add button (+/×) | ✅ | Rotate animation |

## Fase 3: PWA
| Feature | Estado | Notas |
|---------|--------|-------|
| manifest.json | ✅ | Icons, standalone, portrait |
| Service worker | ✅ | Cache v3 |
| Install banner (Android) | ✅ | beforeinstallprompt |
| iOS install sheet | ✅ | Safari detection |
| Offline fallback | ✅ | Offline page + cached CDN libs + cached covers |
| App Store screenshots | ✅ | Mobile (1080x1920) + Desktop (1920x1080) |

## Fase 4: Landing Page
| Feature | Estado | Notas |
|---------|--------|-------|
| Hero section | ✅ | 100vh, headline + CTA |
| Brand animation | ✅ | Tower fall + scatter, scroll-triggered |
| Feature cards | ✅ | 3 cards con animaciones interactivas |
| Showcase | ✅ | Auto-scroll 24 lomos, navy + stars |
| Stats + CTA + Footer | ✅ | Scroll reveal animations |
| White theme | ✅ | Invertido de dark a light |
| Starfield buttons | ✅ | Canvas stars dentro del btn-primary |

## Fase 5: Brand Identity
| Feature | Estado | Notas |
|---------|--------|-------|
| Logo (text-only) | ✅ | "Shelvd" con S bold, sin iconos SVG |
| Tipografía | ✅ | Helvetica Neue 500, -0.04em |
| Logo en app (login) | ✅ | Icono + texto |
| Logo en app (footer) | ✅ | Icono + texto |
| Logo en landing (nav) | ✅ | Icono animado + texto |
| PWA icons | ✅ | 4-bar book stack, gradients + shadows, 192+512px |

## Fase 6: Product Hardening
| Feature | Estado | Notas |
|---------|--------|-------|
| Share loop (/@username) | ✅ | 404.html fallback + catch-all rewrite |
| Public = solo user books | ✅ | Sin demo data, fix deduplicación (96→104 books) |
| Analytics funnel | ✅ | landing_visit, app_visit, auth, book_added, share, profile |
| Covers server-side cache | ⬜ | Pendiente: Open Library/Google Books frágil en cliente |
| Upload optimization | ⬜ | Pendiente: comprimir antes de subir a Supabase Storage |

## Fase 7: Video Teaser (Remotion)
| Feature | Estado | Notas |
|---------|--------|-------|
| LogoScene3D | ✅ | Barras 3D con física del logo HTML, MeshStandardMaterial |
| BookStack3D | ✅ | 15 libros coloreados, cascada top-down, spine textures |
| Composición | ✅ | Stars + Logo(0-90) + Books(85-300), 1080x1920 |
| Review visual | ⬜ | Pendiente ajustes de timing/camera/colores |
| Render final MP4 | ⬜ | `npm run build` en shelvd-teaser/ |

## Session Log
| Fecha | Qué se hizo |
|-------|-------------|
| 2026-03-22 | Landing page: feature cards, showcase, white theme, starfield buttons, logo integrado |
| 2026-03-22 | Bug fixes: sb- prefix IDs, digital covers only, grid click fix. Features: search bar, scroll sound, import/export Excel/Word. Logo revertido a text-only |
| 2026-03-23 | PWA icons rediseñados: 4-bar book stack con degradado y sombras |
| 2026-03-23 | Video teaser Remotion: rewrite LogoScene3D (física correcta) + BookStack3D (cascada con colores). Share loop fix: 404.html fallback, catch-all rewrite, public profile solo user books (96→104), analytics.js |

## Quick Reference: Session Start
```
Read SHELVD_CONTEXT.md and PROJECT_TRACKER.md. Then implement [TASK].
```
