import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initGlobe, destroyGlobe } from './globe.js';

// ─── State ───
let scene, camera, renderer, controls;
let raycaster, mouse;
let bookObjects = [];
let pulledOutBook = null;
let mousePosition = { x: 0, y: 0 };
let currentView = 'shelf'; // 'shelf' | 'grid' | 'globe'
let coverCache = {}; // edition key -> coverUrl

const container = document.getElementById('library-3d-container');
const detailPanel = document.getElementById('book-detail-panel');
const detailBadge = document.getElementById('book-detail-badge');
const detailTitle = document.getElementById('book-detail-title');
const detailAuthor = document.getElementById('book-detail-author');
const detailSummary = document.getElementById('book-detail-summary');
const detailGrid = document.getElementById('book-detail-grid');
let libraryConfigPromise = null;

function getPublicUsernameFromPath() {
    const match = window.location.pathname.match(/^\/@([a-zA-Z0-9_]+)/);
    return match ? match[1].toLowerCase() : null;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeKeyPart(value) {
    return String(value || '').trim().toLowerCase();
}

async function getLibraryConfig() {
    if (!libraryConfigPromise) {
        libraryConfigPromise = fetch('library-config.json')
            .then(r => r.ok ? r.json() : {})
            .catch(() => ({}));
    }
    return libraryConfigPromise;
}

function normalizeIsbnToken(value) {
    return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

function getBookIdentityKey(bookData) {
    const isbn13 = normalizeIsbnToken(bookData?.isbn_13);
    const isbn10 = normalizeIsbnToken(bookData?.isbn_10);
    if (isbn13) return `isbn13:${isbn13}`;
    if (isbn10) return `isbn10:${isbn10}`;

    const title = normalizeKeyPart(bookData?.title);
    const author = normalizeKeyPart(bookData?.author);
    const publisher = normalizeKeyPart(bookData?.publisher);
    const edition = normalizeKeyPart(bookData?.edition);
    const year = normalizeKeyPart(bookData?.published_year);
    const format = normalizeKeyPart(bookData?.format);
    return `meta:${title}|${author}|${publisher}|${edition}|${year}|${format}`;
}

function getCoverCacheKey(bookData) {
    return `edition:${getBookIdentityKey(bookData)}`;
}

function getVisibleCoverUrl(bookData) {
    const cacheKey = getCoverCacheKey(bookData);
    if (bookData?.digital_cover_url) return bookData.digital_cover_url;
    if (bookData?.match_status && bookData.match_status !== 'exact_match') {
        return bookData?.cover || null;
    }
    return coverCache[cacheKey] || bookData?.cover || null;
}

function normalizeSearchValue(value) {
    return String(value || '').toLowerCase();
}

function matchesBookQuery(bookData, query) {
    const normalizedQuery = normalizeSearchValue(query).trim();
    if (!normalizedQuery) return true;

    const isbnQuery = normalizeIsbnToken(query);
    const values = [
        bookData?.title,
        bookData?.author,
        bookData?.publisher,
        bookData?.edition,
        bookData?.language,
        bookData?.isbn_13,
        bookData?.isbn_10
    ];

    return values.some((value) => {
        if (!value) return false;
        const normalizedValue = normalizeSearchValue(value);
        if (normalizedValue.includes(normalizedQuery)) return true;
        if (isbnQuery && normalizeIsbnToken(value).includes(isbnQuery)) return true;
        return false;
    });
}

function getMatchTone(status) {
    if (status === 'exact_match') return { label: 'Exact edition', tone: 'is-exact' };
    if (status === 'needs_confirmation') return { label: 'Needs review', tone: 'is-review' };
    return { label: 'Manual edition', tone: 'is-manual' };
}

function renderBookDetail(bookData) {
    if (!detailPanel || !detailBadge || !detailTitle || !detailAuthor || !detailSummary || !detailGrid) return;
    const matchUi = getMatchTone(bookData?.match_status);
    detailBadge.className = `book-detail-badge ${matchUi.tone}`;
    detailBadge.textContent = matchUi.label;
    detailTitle.textContent = bookData?.title || 'Untitled book';
    detailAuthor.textContent = bookData?.author || 'Unknown author';

    const summaryParts = [
        bookData?.publisher,
        bookData?.published_year,
        bookData?.format
    ].filter(Boolean);
    detailSummary.textContent = summaryParts.length
        ? summaryParts.join(' · ')
        : 'Edition details appear here when available.';

    const detailItems = [
        ['Publisher', bookData?.publisher],
        ['Edition', bookData?.edition],
        ['Published', bookData?.published_year],
        ['Language', bookData?.language],
        ['Translator', bookData?.translator],
        ['Format', bookData?.format],
        ['ISBN-13', bookData?.isbn_13],
        ['ISBN-10', bookData?.isbn_10],
        ['Pages', bookData?.pages]
    ].filter(([, value]) => value);

    detailGrid.innerHTML = detailItems.map(([label, value]) => `
        <div>
            <div class="book-detail-item-label">${label}</div>
            <div class="book-detail-item-value">${value}</div>
        </div>
    `).join('');

    detailPanel.hidden = false;
}

function hideBookDetail() {
    if (!detailPanel) return;
    detailPanel.hidden = true;
}

function findBookObjectById(bookId) {
    return bookObjects.find((book) => String(book.userData.bookId) === String(bookId)) || null;
}

function isLegacyCoverLookupAllowed(bookData) {
    const hasEditionSignals = Boolean(
        bookData?.match_status ||
        normalizeIsbnToken(bookData?.isbn_13) ||
        normalizeIsbnToken(bookData?.isbn_10) ||
        bookData?.publisher ||
        bookData?.edition ||
        bookData?.digital_cover_url ||
        bookData?.cover
    );

    return !hasEditionSignals;
}

// ─── Load books: books.json base + Supabase user books merged ───
async function loadBooksData(username, isPublic) {
    const [baseBooks, libraryConfig] = await Promise.all([
        fetch('books.json').then(r => r.json()).catch(() => []),
        getLibraryConfig()
    ]);

    const seedLibraryOwner = String(libraryConfig.seedLibraryOwner || '').trim().toLowerCase();
    const activeUsername = String(
        isPublic
            ? (username || '')
            : (window.shelvdAuth?.currentProfile?.username || username || '')
    ).trim().toLowerCase();
    const includeSeedLibrary = Boolean(seedLibraryOwner) && activeUsername === seedLibraryOwner;
    const seedBooks = includeSeedLibrary ? baseBooks : [];

    const sb = window.shelvdAuth?.supabase;
    if (!sb) return isPublic ? [] : seedBooks;

    try {
        let query;
        if (isPublic && username) {
            const { data: profile } = await sb
                .from('profiles')
                .select('id')
                .eq('username', username)
                .maybeSingle();

            if (!profile) {
                console.warn('[Shelvd] Public profile not found for username:', username);
                return [];
            }
            query = sb.from('books').select('*').eq('user_id', profile.id);
        } else {
            const { data: { session } } = await sb.auth.getSession();
            if (!session) return seedBooks;
            query = sb.from('books').select('*').eq('user_id', session.user.id);
        }

        const { data: userBooks, error } = await query.order('created_at', { ascending: true, nullsFirst: false });

        if (error || !userBooks) {
            console.error('[Shelvd] Error loading user books:', error);
            return isPublic ? [] : seedBooks;
        }

        // Public view: for the configured seed owner, merge the base library
        // with Supabase-only additions so the shared shelf matches the private one.
        if (isPublic) {
            const publicBooks = userBooks.map(b => ({ ...b, id: `sb-${b.id}` }));
            if (!includeSeedLibrary) {
                publicBooks.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
                return publicBooks;
            }

            const seen = new Set(seedBooks.map(b => getBookIdentityKey(b)));
            const uniquePublicBooks = publicBooks.filter(b => {
                const key = getBookIdentityKey(b);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const mergedPublicBooks = [...seedBooks, ...uniquePublicBooks];
            mergedPublicBooks.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
            return mergedPublicBooks;
        }

        // Private view: merge configured seed books + user books (deduplicate by title+author)
        const seen = new Set(seedBooks.map(b => getBookIdentityKey(b)));
        const uniqueUserBooks = userBooks
            .filter(b => {
                const key = getBookIdentityKey(b);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map(b => ({ ...b, id: `sb-${b.id}` })); // prefix to avoid ID collision with books.json

        // Sort all books alphabetically by title
        const all = [...seedBooks, ...uniqueUserBooks];
        all.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
        return all;
    } catch (err) {
        console.error('[Shelvd] Error loading books:', err);
        return isPublic ? [] : seedBooks;
    }
}

// ─── Init ───
let initialized = false;

async function init(username, isPublic) {
    if (initialized) return;
    initialized = true;

    try {
    let booksData = await loadBooksData(username, isPublic);

    // Public view uses the exact dataset returned by loadBooksData().
    // For the configured seed owner that includes the base shelf + Supabase additions.
    if (isPublic) {
        if (booksData.length === 0) {
            document.getElementById('library-loading').innerHTML =
                `<div style="color:rgba(255,255,255,0.5);font-size:15px;text-align:center;padding:20px;">
                    <div style="font-size:24px;margin-bottom:12px;">No books yet</div>
                    <div>This shelf is empty.</div>
                    <a href="/" style="color:rgba(255,228,196,0.8);margin-top:16px;display:inline-block;text-decoration:none;">Create your own shelf &rarr;</a>
                </div>`;
            return;
        }
    }

    // Scene — deep navy ink
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1a);
    scene.fog = new THREE.Fog(0x0a0f1a, 6, 14); // subtle depth fade

    // Stars
    const starCount = 200;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
        starPositions[i * 3] = (Math.random() - 0.5) * 20;
        starPositions[i * 3 + 1] = Math.random() * 40 - 5;
        starPositions[i * 3 + 2] = -3 - Math.random() * 8;
        starSizes[i] = 0.02 + Math.random() * 0.04;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
    starMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.04,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: true,
        fog: false
    });
    stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Camera
    const isMobile = window.innerWidth <= 768;
    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    const initialDistance = isMobile ? 2.5 : 1.85;
    camera.position.set(initialDistance, 5, 0);
    camera.lookAt(0, 5, 0);

    // Renderer — lighter on mobile
    renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.shadowMap.enabled = !isMobile;
    if (!isMobile) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Controls — zoom + pan only, no rotation
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.5;
    controls.maxDistance = 8;
    controls.enableRotate = false;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.panSpeed = 1.0;
    controls.screenSpacePanning = true;
    controls.target.set(0, 5, 0);

    // Mobile: single finger = pan (scroll), two fingers = pinch zoom
    controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN
    };

    // Desktop: left click = pan (drag to scroll), wheel = zoom
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
    };

    controls.update();

    // Lighting — warm desk lamp feel, with a touch more lift for spine legibility
    const ambient = new THREE.AmbientLight(0xd8c7ad, 1.12);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffe7c8, 1.5);
    dirLight.position.set(7.5, 13, 6.5);
    dirLight.castShadow = !isMobile;
    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -8;
    dirLight.shadow.camera.right = 8;
    dirLight.shadow.camera.top = 8;
    dirLight.shadow.camera.bottom = -8;
    dirLight.shadow.bias = -0.0001;
    dirLight.shadow.normalBias = 0.02;
    dirLight.shadow.radius = 2;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xffddb3, 0.58);
    pointLight.position.set(-9, 9.5, -9);
    scene.add(pointLight);

    // Top-down reading lamp highlight
    const topLight = new THREE.PointLight(0xfffaf1, 0.72);
    topLight.position.set(0, 15.5, 3.5);
    scene.add(topLight);

    // Subtle cool rim keeps book edges separated without flattening the night scene
    const rimLight = new THREE.DirectionalLight(0xc6d4ff, 0.28);
    rimLight.position.set(-6, 8, -7);
    scene.add(rimLight);

    // Dust particles (skip on mobile for performance)
    if (!isMobile) createDustParticles();

    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create books
    booksData.forEach((bookData, index) => {
        createBook(bookData, index);
    });

    // Stack them
    arrangeBooksInStack();

    // Load covers progressively
    loadCoversProgressively(booksData);

    // Expose for import/export module
    window.shelvdBookObjects = bookObjects;
    window.shelvdCoverCache = coverCache;
    window.shelvdGetCoverCacheKey = getCoverCacheKey;

    // Update book count
    document.getElementById('header-book-count').textContent = booksData.length + ' books';

    // Hide loading
    document.getElementById('library-loading').style.display = 'none';

    // Show scrollbar
    document.getElementById('stack-scrollbar').classList.add('visible');

    // Events
    setupEventListeners();
    setupScrollbar();
    setupViewToggle();
    setupSearch();

    // Animation loop
    animate();

    window.addEventListener('resize', onResize);
    } catch (err) {
        console.error('Shelvd init error:', err);
        document.getElementById('library-loading').innerHTML =
            '<div style="color:rgba(255,255,255,0.5);font-size:13px;text-align:center;">Could not load library</div>';
    }
}

// ─── Book Creation ───
function createBook(bookData, index) {
    const pageCount = bookData.pages || 250;
    const bookSpineWidth = Math.min(0.5, Math.max(0.08, pageCount * 0.0004));
    const baseHeight = 1.2;
    const baseCoverWidth = 0.8;

    // Materials: 6 faces
    // Face 0 (+X): white (page edges)
    // Face 1 (-X): spine (will get texture)
    // Face 2 (+Y): white (top)
    // Face 3 (-Y): white (bottom)
    // Face 4 (+Z): front cover (will get texture)
    // Face 5 (-Z): back cover
    const defaultColor = generateBookColor(bookData.title);
    const mobileMode = window.innerWidth <= 768;
    const Mat = mobileMode ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
    const matProps = mobileMode ? {} : { roughness: 1.0, metalness: 0.0 };

    const materials = [];
    for (let i = 0; i < 6; i++) {
        if (i === 0 || i === 2 || i === 3) {
            materials[i] = new Mat({ color: 0xffffff, ...matProps });
        } else {
            materials[i] = new Mat({ color: defaultColor, ...matProps });
        }
    }

    // Create spine text texture immediately
    const spineTexture = createSpineTexture(bookData.title, bookData.author, bookData.pages, baseHeight, bookSpineWidth, defaultColor);
    materials[1] = new Mat({ map: spineTexture, ...matProps });

    // Create front cover placeholder (skip on mobile to save GPU memory)
    if (window.innerWidth > 768) {
        const coverPlaceholder = createCoverPlaceholder(bookData.title, bookData.author, baseCoverWidth, baseHeight, defaultColor);
        materials[4] = new THREE.MeshStandardMaterial({
            map: coverPlaceholder,
            roughness: 1.0,
            metalness: 0.0
        });
    }

    const geometry = new THREE.BoxGeometry(baseCoverWidth, baseHeight, bookSpineWidth);
    const mesh = new THREE.Mesh(geometry, materials);

    mesh.rotation.y = Math.PI / 2;
    const mobileShadow = window.innerWidth > 768;
    mesh.castShadow = mobileShadow;
    mesh.receiveShadow = mobileShadow;

    mesh.userData = {
        bookId: bookData.id,
        bookData: bookData,
        bookSpineWidth: bookSpineWidth,
        baseHeight: baseHeight,
        baseCoverWidth: baseCoverWidth,
        dominantColor: defaultColor,
        originalScale: 1.0,
        isStacked: false,
        isPulledOut: false
    };

    bookObjects.push(mesh);
    scene.add(mesh);
}

// ─── Spine Texture ───
function createSpineTexture(title, author, pages, bookHeight, bookSpineWidth, bgColor) {
    const baseResolution = window.innerWidth <= 768 ? 1024 : 2048;
    const aspectRatio = bookHeight / bookSpineWidth;

    let canvasWidth, canvasHeight;
    if (aspectRatio > 1) {
        canvasHeight = baseResolution;
        canvasWidth = Math.round(baseResolution / aspectRatio);
    } else {
        canvasWidth = baseResolution;
        canvasHeight = Math.round(baseResolution * aspectRatio);
    }

    const minDim = 256;
    if (canvasWidth < minDim || canvasHeight < minDim) {
        const scale = Math.max(minDim / canvasWidth, minDim / canvasHeight);
        canvasWidth = Math.round(canvasWidth * scale);
        canvasHeight = Math.round(canvasHeight * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // ── Background: subtle vertical gradient ──
    const bgHex = typeof bgColor === 'number'
        ? '#' + bgColor.toString(16).padStart(6, '0')
        : (bgColor || '#2a2a2a');
    const bgRgb = hexToRgb(bgHex);
    const darkerBg = `rgb(${Math.max(0, bgRgb.r - 18)},${Math.max(0, bgRgb.g - 18)},${Math.max(0, bgRgb.b - 18)})`;

    const grad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    grad.addColorStop(0, bgHex);
    grad.addColorStop(1, darkerBg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // ── Bottom band (8% height) ──
    const bandHeight = Math.round(canvasHeight * 0.08);
    const bandColor = `rgb(${Math.max(0, bgRgb.r - 34)},${Math.max(0, bgRgb.g - 34)},${Math.max(0, bgRgb.b - 34)})`;
    ctx.fillStyle = bandColor;
    ctx.fillRect(0, canvasHeight - bandHeight, canvasWidth, bandHeight);

    // ── Top accent line (2px) ──
    ctx.fillStyle = `rgba(255,255,255,0.17)`;
    ctx.fillRect(0, 0, canvasWidth, 2);

    // ── Auto-contrast: light text on dark bg, dark text on light bg ──
    const luminance = (bgRgb.r * 0.299 + bgRgb.g * 0.587 + bgRgb.b * 0.114) / 255;
    const textColor = luminance > 0.45 ? '#000000' : '#ffffff';
    const textAlpha = luminance > 0.45 ? 0.88 : 0.95;
    const subtextAlpha = luminance > 0.45 ? 0.54 : 0.6;
    const lineAlpha = luminance > 0.45 ? 0.18 : 0.24;

    // All text is drawn rotated -90° (spine reads bottom-to-top)
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.rotate(-Math.PI / 2);

    // Now: x axis = along spine height, y axis = across spine width
    // Available "width" for text = canvasHeight (minus bands), "height" = canvasWidth
    const textAreaWidth = canvasHeight * 0.82; // leave margin for bands
    const textAreaHeight = canvasWidth;

    // ── Title: uppercase, tracked, condensed ──
    const titleText = title.toUpperCase();
    let titleSize = Math.min(160, Math.max(36, textAreaHeight * 0.38));
    ctx.font = `700 ${titleSize}px "SF Mono", "Menlo", "Consolas", "Courier New", monospace`;
    ctx.letterSpacing = '3px';
    let metrics = ctx.measureText(titleText);
    if (metrics.width > textAreaWidth * 0.85) {
        titleSize = Math.max(28, Math.floor(titleSize * (textAreaWidth * 0.85) / metrics.width));
        ctx.font = `700 ${titleSize}px "SF Mono", "Menlo", "Consolas", "Courier New", monospace`;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.globalAlpha = textAlpha;
    ctx.fillText(titleText, 0, -textAreaHeight * 0.08);

    // ── Separator line ──
    const separatorY = titleSize * 0.45;
    const lineWidth = Math.min(metrics.width * 0.6, textAreaWidth * 0.3);
    ctx.globalAlpha = lineAlpha;
    ctx.fillStyle = textColor;
    ctx.fillRect(-lineWidth / 2, separatorY - 1, lineWidth, 2);

    // ── Author: smaller, lighter ──
    const authorText = (author || '').toUpperCase();
    let authorSize = Math.max(20, titleSize * 0.48);
    ctx.font = `400 ${authorSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.globalAlpha = subtextAlpha;
    ctx.fillStyle = textColor;

    let authorMetrics = ctx.measureText(authorText);
    if (authorMetrics.width > textAreaWidth * 0.75) {
        authorSize = Math.max(16, Math.floor(authorSize * (textAreaWidth * 0.75) / authorMetrics.width));
        ctx.font = `400 ${authorSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    }
    ctx.fillText(authorText, 0, separatorY + authorSize * 1.1);

    // ── Page count in bottom band area ──
    if (pages) {
        const pagesText = `${pages}p`;
        const pagesSize = Math.max(14, titleSize * 0.28);
        ctx.font = `300 ${pagesSize}px "SF Mono", "Menlo", "Consolas", monospace`;
        ctx.globalAlpha = subtextAlpha * 0.6;
        ctx.fillStyle = textColor;
        // Position at the "bottom" of the spine (which is the left side in rotated space)
        ctx.fillText(pagesText, (canvasHeight * 0.42) - (bandHeight * 0.5), 0);
    }

    ctx.globalAlpha = 1;
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
        r: parseInt(clean.substring(0, 2), 16) || 0,
        g: parseInt(clean.substring(2, 4), 16) || 0,
        b: parseInt(clean.substring(4, 6), 16) || 0
    };
}

// ─── Cover Placeholder ───
function createCoverPlaceholder(title, author, width, height, bgColor) {
    const canvas = document.createElement('canvas');
    const res = 1024;
    canvas.width = res;
    canvas.height = Math.round(res * (height / width));
    const ctx = canvas.getContext('2d');

    // Background — same color as book with subtle gradient
    const colorStr = typeof bgColor === 'number'
        ? '#' + bgColor.toString(16).padStart(6, '0')
        : (bgColor || '#3a3a5c');
    const rgb = hexToRgb(colorStr);

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `rgba(${rgb.r + 15}, ${rgb.g + 15}, ${rgb.b + 15}, 1)`);
    grad.addColorStop(1, `rgba(${Math.max(0, rgb.r - 10)}, ${Math.max(0, rgb.g - 10)}, ${Math.max(0, rgb.b - 10)}, 1)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle border
    ctx.strokeStyle = `rgba(${Math.min(255, rgb.r + 40)}, ${Math.min(255, rgb.g + 40)}, ${Math.min(255, rgb.b + 40)}, 0.3)`;
    ctx.lineWidth = 4;
    const m = 30;
    ctx.strokeRect(m, m, canvas.width - m * 2, canvas.height - m * 2);

    // Text color — auto contrast
    const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    const textColor = lum > 0.45
        ? `rgba(0, 0, 0, 0.7)`
        : `rgba(255, 255, 255, 0.75)`;
    const subtextColor = lum > 0.45
        ? `rgba(0, 0, 0, 0.4)`
        : `rgba(255, 255, 255, 0.4)`;

    // Title — centered, word wrap
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const titleSize = Math.round(canvas.width * 0.065);
    ctx.font = `700 ${titleSize}px "SF Pro Display", "Helvetica Neue", sans-serif`;

    const maxWidth = canvas.width * 0.7;
    const words = title.toUpperCase().split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);

    const lineHeight = titleSize * 1.3;
    const totalTextHeight = lines.length * lineHeight;
    const startY = canvas.height * 0.42 - totalTextHeight / 2;

    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], canvas.width / 2, startY + i * lineHeight);
    }

    // Separator line
    const sepY = startY + lines.length * lineHeight + titleSize * 0.6;
    ctx.strokeStyle = textColor;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.3, sepY);
    ctx.lineTo(canvas.width * 0.7, sepY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Author
    const authorSize = Math.round(canvas.width * 0.038);
    ctx.fillStyle = subtextColor;
    ctx.font = `400 ${authorSize}px "SF Pro Display", "Helvetica Neue", sans-serif`;
    ctx.fillText(author, canvas.width / 2, sepY + authorSize * 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    return texture;
}

// ─── Dust Particles ───
let dustParticles;
let stars, starMaterial;
function createDustParticles() {
    const count = 120;
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 6;     // x: around the stack
        positions[i * 3 + 1] = Math.random() * 20;          // y: full stack height
        positions[i * 3 + 2] = (Math.random() - 0.5) * 4;  // z: depth
        velocities.push({
            x: (Math.random() - 0.5) * 0.002,
            y: (Math.random() - 0.5) * 0.003,
            z: (Math.random() - 0.5) * 0.002
        });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffe4c4,
        size: 0.012,
        transparent: true,
        opacity: 0.3,
        sizeAttenuation: true,
        depthWrite: false
    });

    dustParticles = new THREE.Points(geometry, material);
    dustParticles.userData.velocities = velocities;
    scene.add(dustParticles);
}

function animateDust() {
    if (!dustParticles) return;
    const positions = dustParticles.geometry.attributes.position.array;
    const velocities = dustParticles.userData.velocities;

    for (let i = 0; i < velocities.length; i++) {
        positions[i * 3] += velocities[i].x;
        positions[i * 3 + 1] += velocities[i].y;
        positions[i * 3 + 2] += velocities[i].z;

        // Gentle drift — slowly change direction
        velocities[i].x += (Math.random() - 0.5) * 0.0003;
        velocities[i].y += (Math.random() - 0.5) * 0.0003;
        velocities[i].z += (Math.random() - 0.5) * 0.0003;

        // Clamp velocity
        velocities[i].x = Math.max(-0.004, Math.min(0.004, velocities[i].x));
        velocities[i].y = Math.max(-0.005, Math.min(0.005, velocities[i].y));
        velocities[i].z = Math.max(-0.004, Math.min(0.004, velocities[i].z));

        // Wrap around bounds
        if (positions[i * 3] > 3) positions[i * 3] = -3;
        if (positions[i * 3] < -3) positions[i * 3] = 3;
        if (positions[i * 3 + 1] > 22) positions[i * 3 + 1] = -1;
        if (positions[i * 3 + 1] < -1) positions[i * 3 + 1] = 22;
        if (positions[i * 3 + 2] > 2) positions[i * 3 + 2] = -2;
        if (positions[i * 3 + 2] < -2) positions[i * 3 + 2] = 2;
    }
    dustParticles.geometry.attributes.position.needsUpdate = true;
}

// ─── Color Generation ───
function generateBookColor(title) {
    // Generate a deterministic muted color from title
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    const s = 25 + Math.abs((hash >> 8) % 30); // 25-55% saturation
    const l = 35 + Math.abs((hash >> 16) % 25); // 35-60% lightness
    return hslToHex(h, s, l);
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color);
    };
    return (f(0) << 16) | (f(8) << 8) | f(4);
}

// ─── Stack Arrangement ───
function arrangeBooksInStack() {
    let currentY = 0;
    const bookSpacing = 0.02;
    const reversed = [...bookObjects].reverse();

    reversed.forEach((book, index) => {
        const spineWidth = book.userData.bookSpineWidth;
        const bookCenterY = currentY + (spineWidth / 2);

        book.position.set(0, bookCenterY, 0);

        // Lay flat, cover up, with random Z tilt
        const isEdge = index === 0 || index === reversed.length - 1;
        const tenDeg = (10 * Math.PI) / 180;
        const randomZ = isEdge ? 0 : (Math.random() - 0.5) * 2 * tenDeg;

        book.rotation.x = -Math.PI / 2;
        book.rotation.y = Math.PI;
        book.rotation.z = randomZ;

        book.scale.set(1, 1, 1);
        book.userData.isStacked = true;
        book.userData.stackPosition = { x: 0, y: bookCenterY, z: 0 };
        book.userData.stackRotation = { x: -Math.PI / 2, y: Math.PI, z: randomZ };

        currentY += spineWidth + bookSpacing;
    });

    // Camera to middle of stack
    const totalHeight = currentY;
    const isMobile = window.innerWidth <= 768;
    const cameraDistance = isMobile ? 2.5 : 1.85;
    const startY = isMobile ? totalHeight : totalHeight / 2;

    camera.position.set(cameraDistance, startY, 0);
    controls.target.set(0, startY, 0);
    controls.update();

    window.stackBounds = { top: totalHeight, bottom: 0, height: totalHeight };
}

// ─── Cover Loading ───
async function loadCoversProgressively(booksData) {
    const CACHE_VERSION = 'v11-cover-lock';
    try {
        const ver = localStorage.getItem('book-covers-version');
        if (ver === CACHE_VERSION) {
            const cached = localStorage.getItem('book-covers-cache');
            if (cached) coverCache = JSON.parse(cached);
        } else {
            localStorage.removeItem('book-covers-cache');
            localStorage.setItem('book-covers-version', CACHE_VERSION);
        }
    } catch (e) { /* ignore */ }

    // First pass: apply cached/persisted covers, queue rest for fetch
    const uncached = [];
    for (const bookData of booksData) {
        const cacheKey = getCoverCacheKey(bookData);
        if (bookData?.match_status && bookData.match_status !== 'exact_match' && bookData?.cover) {
            delete coverCache[cacheKey];
        }
        if (bookData.digital_cover_url) {
            coverCache[cacheKey] = bookData.digital_cover_url;
        }

        const visibleCover = getVisibleCoverUrl(bookData);
        if (visibleCover) {
            applyCoverToBook(bookData.id, visibleCover);
        } else if (normalizeIsbnToken(bookData?.isbn_13) || normalizeIsbnToken(bookData?.isbn_10) || isLegacyCoverLookupAllowed(bookData)) {
            uncached.push(bookData);
        }
    }

    try {
        localStorage.setItem('book-covers-cache', JSON.stringify(coverCache));
    } catch (e) { /* ignore */ }
    window.shelvdCoverCache = coverCache;

    // Second pass: fetch uncached in parallel batches (smaller on mobile)
    const isMobileCover = window.innerWidth <= 768;
    const BATCH_SIZE = isMobileCover ? 2 : 6;
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        const batch = uncached.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
            batch.map(bookData => fetchEditionCover(bookData))
        );

        results.forEach((result, idx) => {
            const bookData = batch[idx];
            const cacheKey = getCoverCacheKey(bookData);
            const coverUrl = result?.coverUrl || null;
            console.log(`[Shelvd] Cover fetch for "${bookData.title}":`, coverUrl ? 'found' : 'not found', coverUrl);
            if (coverUrl) {
                coverCache[cacheKey] = coverUrl;
                if (result?.isVerified) {
                    bookData.digital_cover_url = coverUrl;
                }
                applyCoverToBook(bookData.id, coverUrl);

                // Persist verified covers only, so edition-exact matches travel across devices.
                if (result?.isVerified && String(bookData.id).startsWith('sb-')) {
                    const realId = bookData.id.replace('sb-', '');
                    const sb = window.shelvdAuth?.supabase;
                    if (sb) {
                        sb.from('books').update({ digital_cover_url: coverUrl })
                            .eq('id', realId).then(() => {});
                    }
                }
            }
        });

        // Save cache after each batch
        try {
            localStorage.setItem('book-covers-cache', JSON.stringify(coverCache));
        } catch (e) { /* ignore */ }
        window.shelvdCoverCache = coverCache;
    }
}

// Fetch with timeout
function fetchWithTimeout(url, ms = 5000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

async function fetchEditionCover(bookData) {
    const isbn = normalizeIsbnToken(bookData?.isbn_13) || normalizeIsbnToken(bookData?.isbn_10);

    if (isbn) {
        const openLibraryCover = await fetchOpenLibraryCoverByIsbn(isbn);
        if (openLibraryCover) {
            return { coverUrl: openLibraryCover, isVerified: true };
        }

        const googleBooksCover = await fetchGoogleBooksCoverByIsbn(isbn);
        if (googleBooksCover) {
            return { coverUrl: googleBooksCover, isVerified: true };
        }
    }

    if (isLegacyCoverLookupAllowed(bookData)) {
        const legacyCover = await fetchLegacyCoverApproximation(bookData?.title, bookData?.author);
        if (legacyCover) {
            return { coverUrl: legacyCover, isVerified: false };
        }
    }

    return { coverUrl: null, isVerified: false };
}

async function fetchLegacyCoverApproximation(title, author) {
    const openLibraryCover = await fetchOpenLibraryCover(title, author);
    if (openLibraryCover) return openLibraryCover;

    const openLibraryTitleOnly = await fetchOpenLibraryCover(title, null);
    if (openLibraryTitleOnly) return openLibraryTitleOnly;

    const googleBooksCover = await fetchGoogleBooksCover(title, author);
    if (googleBooksCover) return googleBooksCover;

    return null;
}

async function fetchOpenLibraryCoverByIsbn(isbn) {
    try {
        const coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
        const resp = await fetchWithTimeout(coverUrl);
        if (resp.ok) return coverUrl;
    } catch (e) { /* skip */ }
    return null;
}

async function fetchGoogleBooksCoverByIsbn(isbn) {
    try {
        const query = encodeURIComponent(`isbn:${isbn}`);
        const resp = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`);
        const data = await resp.json();
        if (data.items && data.items[0]) {
            const info = data.items[0].volumeInfo;
            if (info.imageLinks) {
                const url = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail;
                if (url) {
                    return url
                        .replace('http://', 'https://')
                        .replace('zoom=1', 'zoom=2')
                        .replace('&edge=curl', '');
                }
            }
        }
    } catch (e) { /* skip */ }
    return null;
}

async function fetchOpenLibraryCover(title, author) {
    try {
        const query = author
            ? encodeURIComponent(`${title} ${author}`)
            : encodeURIComponent(title);
        const resp = await fetchWithTimeout(`https://openlibrary.org/search.json?q=${query}&limit=1&fields=cover_i`);
        const data = await resp.json();
        if (data.docs && data.docs[0] && data.docs[0].cover_i) {
            return `https://covers.openlibrary.org/b/id/${data.docs[0].cover_i}-L.jpg`;
        }
    } catch (e) { /* skip */ }
    return null;
}

async function fetchGoogleBooksCover(title, author) {
    try {
        const query = encodeURIComponent(`${title} ${author}`);
        const resp = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`);
        const data = await resp.json();
        if (data.items && data.items[0]) {
            const info = data.items[0].volumeInfo;
            if (info.imageLinks) {
                const url = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail;
                if (url) {
                    return url
                        .replace('http://', 'https://')
                        .replace('zoom=1', 'zoom=2')
                        .replace('&edge=curl', '');
                }
            }
        }
    } catch (e) { /* skip */ }
    return null;
}

function applyCoverToBook(bookId, coverUrl) {
    const book = bookObjects.find(b => b.userData.bookId === bookId);
    if (!book) {
        console.log(`[Shelvd] applyCoverToBook: book ${bookId} not found in scene`);
        return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = function () {
        const bookHeight = book.userData.baseHeight;
        const spineWidth = book.userData.bookSpineWidth;
        const isMobileMat = window.innerWidth <= 768;

        // Extract dominant color
        getDominantColor(img, function (color) {
            const hexColor = parseInt(color.replace('#', '0x'));
            book.userData.dominantColor = hexColor;

            for (let i = 0; i < 6; i++) {
                if (i !== 4 && i !== 0 && i !== 2 && i !== 3 && book.material[i]) {
                    book.material[i].color.setHex(hexColor);
                }
            }

            const spineTexture = createSpineTexture(
                book.userData.bookData.title, book.userData.bookData.author,
                book.userData.bookData.pages, bookHeight, spineWidth, color
            );
            book.material[1] = isMobileMat
                ? new THREE.MeshBasicMaterial({ map: spineTexture })
                : new THREE.MeshStandardMaterial({ map: spineTexture, roughness: 1.0, metalness: 0.0 });
        });

        // Cover texture — direct from CORS-enabled image
        const texture = new THREE.Texture(img);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.generateMipmaps = true;
        texture.needsUpdate = true;

        book.material[4] = isMobileMat
            ? new THREE.MeshBasicMaterial({ map: texture })
            : new THREE.MeshStandardMaterial({ map: texture, roughness: 1.0, metalness: 0.0 });
    };

    // If CORS fails (Google Books), image won't load for 3D but grid still works
    img.onerror = function () {
        console.log('[Shelvd] CORS blocked for 3D texture:', book.userData.bookData.title);
    };

    img.src = coverUrl;
}

function getDominantColor(img, callback) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const maxSize = 50;
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    const hex = '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    callback(hex);
}

// ─── Pull Out / Return ───
function pullOutBookFromStack(book) {
    if (pulledOutBook && pulledOutBook !== book) {
        returnBookToStack(pulledOutBook);
    }

    book.userData.originalScale = 1.0;
    pulledOutBook = book;
    book.userData.isPulledOut = true;
    book.userData.isStacked = false;

    // Calculate pull-out position
    const cameraPos = camera.position.clone();
    const cameraTarget = controls.target.clone();
    const cameraForward = new THREE.Vector3().subVectors(cameraTarget, cameraPos).normalize();

    const bookWidth = book.geometry.parameters.width || 0.8;
    const bookHeight = book.geometry.parameters.height || 1.2;
    const maxDim = Math.max(bookWidth, bookHeight);

    const bookStackPos = new THREE.Vector3(
        book.userData.stackPosition.x,
        book.userData.stackPosition.y,
        book.userData.stackPosition.z
    );
    const distanceToStack = cameraPos.distanceTo(bookStackPos);
    let pullDist = distanceToStack * 0.4;
    const minDist = maxDim * 1.5 + 0.3;
    pullDist = Math.max(pullDist, minDist);
    pullDist = Math.min(pullDist, distanceToStack * 0.8);

    const pullPos = new THREE.Vector3()
        .copy(cameraTarget)
        .add(cameraForward.clone().multiplyScalar(-pullDist));

    if (window.innerWidth <= 768) {
        const dist = cameraPos.distanceTo(pullPos);
        const fov = camera.fov * (Math.PI / 180);
        const vh = 2 * Math.tan(fov / 2) * dist;
        pullPos.y += vh * 0.03;
    }

    book.userData.basePosition = { x: pullPos.x, y: pullPos.y, z: pullPos.z };
    book.userData.targetPosition = { x: pullPos.x, y: pullPos.y, z: pullPos.z };

    // Scale to fit viewport
    const dist = cameraPos.distanceTo(pullPos);
    const fov = camera.fov * (Math.PI / 180);
    const viewH = 2 * Math.tan(fov / 2) * dist;
    const viewW = viewH * (container.clientWidth / container.clientHeight);
    const scaleX = (viewW * 0.7) / bookWidth;
    const scaleY = (viewH * 0.7) / bookHeight;
    book.userData.targetScale = Math.min(scaleX, scaleY, 1.0);

    // Rotate to face camera
    const lookDir = new THREE.Vector3().subVectors(cameraPos, pullPos).normalize();
    book.userData.targetRotation = Math.atan2(lookDir.x, lookDir.z);
    book.userData.targetRotationX = 0;
    book.userData.targetRotationZ = 0;

    // Show arrow, hide toggle
    document.getElementById('library-book-arrow').classList.add('visible');
    document.getElementById('view-toggle-pill').classList.add('hidden');
    renderBookDetail(book.userData.bookData);
}

function returnBookToStack(book) {
    if (!book.userData.stackPosition) return;

    book.userData.isPulledOut = false;
    book.userData.isStacked = true;

    book.userData.targetPosition = { ...book.userData.stackPosition };

    const norm = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    const shortest = (cur, tgt) => {
        cur = norm(cur); tgt = norm(tgt);
        let d = tgt - cur;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return norm(cur + d);
    };

    const sr = book.userData.stackRotation;
    book.rotation.y = norm(book.rotation.y);
    book.rotation.x = norm(book.rotation.x);
    book.rotation.z = norm(book.rotation.z);

    book.userData.targetRotation = shortest(book.rotation.y, sr.y);
    book.userData.targetRotationX = shortest(book.rotation.x, sr.x);
    book.userData.targetRotationZ = shortest(book.rotation.z, sr.z || 0);

    delete book.userData.basePosition;
    book.userData.targetScale = 1.0;

    if (pulledOutBook === book) {
        pulledOutBook = null;
        mousePosition = { x: 0, y: 0 };
    }

    document.getElementById('library-book-arrow').classList.remove('visible');
    document.getElementById('view-toggle-pill').classList.remove('hidden');
    hideBookDetail();
}

// ─── Event Handlers ───
function setupEventListeners() {
    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('mousemove', onMouseMoveTrack);
    window.addEventListener('mousemove', onMouseMoveTrack);

    // Mouse wheel → scroll vertically through the stack
    renderer.domElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!window.stackBounds) return;
        const scrollSpeed = 0.003;
        const delta = e.deltaY * scrollSpeed;
        const newY = camera.position.y - delta;
        const clampedY = Math.max(window.stackBounds.bottom, Math.min(window.stackBounds.top, newY));
        camera.position.y = clampedY;
        controls.target.y = clampedY;
        controls.update();
    }, { passive: false });

    // Touch
    let touchStartPos = null;
    let touchStartTime = 0;

    renderer.domElement.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            touchStartTime = Date.now();
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchend', (e) => {
        if (!touchStartPos || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - touchStartPos.x;
        const dy = e.changedTouches[0].clientY - touchStartPos.y;
        const duration = Date.now() - touchStartTime;

        // Swipe up to return book
        if (pulledOutBook && dy < -50 && duration < 500) {
            returnBookToStack(pulledOutBook);
            touchStartPos = null;
            return;
        }

        // Tap to select (only if minimal movement)
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && duration < 300) {
            handleBookTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
        touchStartPos = null;
    }, { passive: false });

    // Swipe up arrow click
    document.getElementById('library-book-arrow').addEventListener('click', () => {
        if (pulledOutBook) returnBookToStack(pulledOutBook);
    });
}

function onCanvasClick(event) {
    handleBookTap(event.clientX, event.clientY);
}

function handleBookTap(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(bookObjects);

    if (intersects.length > 0) {
        const book = intersects[0].object;
        if (pulledOutBook === book) {
            returnBookToStack(book);
        } else {
            pullOutBookFromStack(book);
        }
    } else if (pulledOutBook) {
        returnBookToStack(pulledOutBook);
    }
}

function onMouseMoveTrack(event) {
    mousePosition.x = (event.clientX / window.innerWidth) * 2 - 1;
    mousePosition.y = -((event.clientY / window.innerHeight) * 2 - 1);
}

// ─── Scrollbar ───
function setupScrollbar() {
    const thumb = document.getElementById('stack-scrollbar-thumb');
    const scrollbar = document.getElementById('stack-scrollbar');
    let isDragging = false;

    function scrollTo(clientY) {
        if (!window.stackBounds) return;
        const rect = scrollbar.getBoundingClientRect();
        const trackHeight = rect.height - thumb.offsetHeight;
        const pct = Math.max(0, Math.min(1, (clientY - rect.top) / trackHeight));
        const targetY = window.stackBounds.top - pct * window.stackBounds.height;
        controls.target.y = targetY;
        camera.position.y = targetY;
        controls.update();
        checkFocusedBook();
    }

    // Mouse
    thumb.addEventListener('mousedown', (e) => { isDragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (isDragging) scrollTo(e.clientY); });
    window.addEventListener('mouseup', () => { isDragging = false; });

    // Touch — drag thumb or tap track
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); }, { passive: false });
    scrollbar.addEventListener('touchstart', (e) => {
        isDragging = true;
        scrollTo(e.touches[0].clientY);
        e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches.length === 1) {
            scrollTo(e.touches[0].clientY);
            e.preventDefault();
        }
    }, { passive: false });
    window.addEventListener('touchend', () => { isDragging = false; });
}

function updateScrollbar() {
    if (!window.stackBounds || !camera) return;
    const thumb = document.getElementById('stack-scrollbar-thumb');
    const scrollbar = document.getElementById('stack-scrollbar');
    const trackHeight = scrollbar.offsetHeight - thumb.offsetHeight;

    const pct = 1 - (camera.position.y - window.stackBounds.bottom) / window.stackBounds.height;
    const clampedPct = Math.max(0, Math.min(1, pct));
    thumb.style.top = (clampedPct * trackHeight) + 'px';
}

// ─── Globe Book Factory ───
function makeGlobeBookMesh(bookData) {
    const pageCount = bookData.pages || 250;
    const bookSpineWidth = Math.min(0.5, Math.max(0.08, pageCount * 0.0004));
    const baseHeight = 1.2;
    const baseCoverWidth = 0.8;
    const defaultColor = generateBookColor(bookData.title);

    const materials = [];
    for (let i = 0; i < 6; i++) {
        if (i === 0 || i === 2 || i === 3) {
            materials[i] = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 1.0, metalness: 0.0 });
        } else {
            materials[i] = new THREE.MeshStandardMaterial({ color: defaultColor, roughness: 1.0, metalness: 0.0 });
        }
    }

    const spineTexture = createSpineTexture(bookData.title, bookData.author, bookData.pages, baseHeight, bookSpineWidth, defaultColor);
    materials[1] = new THREE.MeshStandardMaterial({ map: spineTexture, roughness: 1.0, metalness: 0.0 });

    const coverPlaceholder = createCoverPlaceholder(bookData.title, bookData.author, baseCoverWidth, baseHeight, defaultColor);
    materials[4] = new THREE.MeshStandardMaterial({ map: coverPlaceholder, roughness: 1.0, metalness: 0.0 });

    const geometry = new THREE.BoxGeometry(baseCoverWidth, baseHeight, bookSpineWidth);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.userData = {
        bookId: bookData.id,
        bookData: bookData,
        bookSpineWidth: bookSpineWidth,
        baseHeight: baseHeight,
        baseCoverWidth: baseCoverWidth,
        dominantColor: defaultColor,
    };
    return mesh;
}

function applyGlobeCover(mesh, coverUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
        getDominantColor(img, function (color) {
            const hexColor = parseInt(color.replace('#', '0x'));
            for (let i = 0; i < 6; i++) {
                if (i !== 4 && i !== 0 && i !== 2 && i !== 3 && mesh.material[i]) {
                    mesh.material[i].color.setHex(hexColor);
                }
            }
            const spineTexture = createSpineTexture(
                mesh.userData.bookData.title, mesh.userData.bookData.author,
                mesh.userData.bookData.pages, mesh.userData.baseHeight,
                mesh.userData.bookSpineWidth, color
            );
            mesh.material[1] = new THREE.MeshStandardMaterial({ map: spineTexture, roughness: 1.0, metalness: 0.0 });
        });

        const texture = new THREE.Texture(img);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        mesh.material[4] = new THREE.MeshStandardMaterial({ map: texture, roughness: 1.0, metalness: 0.0 });
    };
    img.onerror = function () { /* keep placeholder */ };
    img.src = coverUrl;
}

// ─── View Toggle ───
function setupViewToggle() {
    document.querySelectorAll('.view-toggle input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const view = e.target.value;
            switchView(view);
        });
    });
}

function switchView(view) {
    currentView = view;
    const gridEl = document.getElementById('grid-view');
    const globeEl = document.getElementById('globe-view');
    const containerEl = document.getElementById('library-3d-container');
    const scrollbar = document.getElementById('stack-scrollbar');

    // Tear down globe if leaving it
    if (view !== 'globe' && globeEl.dataset.globeActive === 'true') {
        destroyGlobe(globeEl);
        globeEl.dataset.globeActive = '';
    }

    if (view === 'grid') {
        if (pulledOutBook) returnBookToStack(pulledOutBook);
        hideBookDetail();
        containerEl.style.display = 'none';
        scrollbar.classList.remove('visible');
        globeEl.style.display = 'none';
        gridEl.style.display = 'block';
        renderGridView();
    } else if (view === 'globe') {
        if (pulledOutBook) returnBookToStack(pulledOutBook);
        hideBookDetail();
        containerEl.style.display = 'none';
        scrollbar.classList.remove('visible');
        gridEl.style.display = 'none';
        globeEl.style.display = 'block';
        const books = bookObjects.map(b => b.userData.bookData);
        initGlobe(globeEl, books, getVisibleCoverUrl, makeGlobeBookMesh, applyGlobeCover, (bookData) => renderBookDetail(bookData));
        globeEl.dataset.globeActive = 'true';
    } else {
        // shelf
        globeEl.style.display = 'none';
        gridEl.style.display = 'none';
        containerEl.style.display = 'block';
        scrollbar.classList.add('visible');
        onResize();
    }
}

function renderGridView() {
    const gridEl = document.getElementById('grid-view');
    const books = bookObjects.map(b => b.userData.bookData);

    gridEl.innerHTML = `<div class="grid-container">${books.map((b, i) => {
        const coverUrl = getVisibleCoverUrl(b);
        const metaParts = [b.publisher, b.published_year, b.isbn_13 || b.isbn_10].filter(Boolean);
        const metaHtml = metaParts.length
            ? `<div class="grid-book-meta">${escapeHtml(metaParts.join(' · '))}</div>`
            : '';
        const coverHtml = coverUrl
            ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(b.title)}" loading="lazy">`
            : `<div class="placeholder">${escapeHtml(b.title)}</div>`;
        return `
            <div class="grid-book" style="animation-delay: ${i * 20}ms" data-book-id="${b.id}">
                <div class="grid-book-cover">${coverHtml}</div>
                <div class="grid-book-info">
                    <div class="grid-book-title">${escapeHtml(b.title)}</div>
                    <div class="grid-book-author">${escapeHtml(b.author || 'Unknown author')}</div>
                    ${metaHtml}
                </div>
            </div>`;
    }).join('')}</div>`;

    // Click handler for grid books
    gridEl.querySelectorAll('.grid-book').forEach(el => {
        el.addEventListener('click', () => {
            // Switch to shelf and pull out
            document.querySelector('.view-toggle input[value="shelf"]').checked = true;
            switchView('shelf');
            const book = findBookObjectById(el.dataset.bookId);
            if (book) {
                // Scroll to book position
                camera.position.y = book.userData.stackPosition.y;
                controls.target.y = book.userData.stackPosition.y;
                controls.update();
                setTimeout(() => pullOutBookFromStack(book), 300);
            }
        });
    });
}

// ─── Search ───
function setupSearch() {
    const container = document.getElementById('search-container');
    const toggleBtn = document.getElementById('search-toggle-btn');
    const inputWrap = document.getElementById('search-input-wrap');
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');

    if (!container || !input) return;

    function openSearch() {
        container.classList.add('open');
        setTimeout(() => input.focus(), 300);
    }

    function closeSearch() {
        container.classList.remove('open');
        input.value = '';
        clearBtn.style.display = 'none';
        clearSearchResults();
    }

    toggleBtn.addEventListener('click', openSearch);

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        clearSearchResults();
        input.focus();
    });

    // Close on Escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSearch();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (container.classList.contains('open') && !container.contains(e.target)) {
            closeSearch();
        }
    });

    // Debounced search
    let debounceTimer = null;
    input.addEventListener('input', () => {
        clearBtn.style.display = input.value ? 'flex' : 'none';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => performSearch(input.value.trim()), 200);
    });

    // Enter key in shelf mode → pull out first match
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && currentView === 'shelf') {
            const q = input.value.trim();
            if (!q) return;
            const match = bookObjects.find(b => matchesBookQuery(b.userData.bookData, q));
            if (match) {
                camera.position.y = match.userData.stackPosition.y;
                controls.target.y = match.userData.stackPosition.y;
                controls.update();
                setTimeout(() => pullOutBookFromStack(match), 200);
                closeSearch();
            }
        }
    });
}

function performSearch(query) {
    if (!query) {
        clearSearchResults();
        return;
    }

    if (currentView === 'grid') {
        // Filter grid items
        document.querySelectorAll('.grid-book').forEach(el => {
            const bookData = findBookObjectById(el.dataset.bookId)?.userData?.bookData;
            if (bookData && matchesBookQuery(bookData, query)) {
                el.classList.remove('search-hidden');
            } else {
                el.classList.add('search-hidden');
            }
        });

        // Update count
        updateSearchCount();
    } else {
        // Shelf mode: scroll to first match
        const match = bookObjects.find(b => matchesBookQuery(b.userData.bookData, query));
        if (match && match.userData.stackPosition) {
            camera.position.y = match.userData.stackPosition.y;
            controls.target.y = match.userData.stackPosition.y;
            controls.update();
        }
    }
}

function clearSearchResults() {
    // Remove grid filters
    document.querySelectorAll('.grid-book.search-hidden').forEach(el => {
        el.classList.remove('search-hidden');
    });
    // Remove count
    const existing = document.querySelector('.search-count');
    if (existing) existing.remove();
}

function updateSearchCount() {
    const total = document.querySelectorAll('.grid-book').length;
    const visible = total - document.querySelectorAll('.grid-book.search-hidden').length;

    let countEl = document.querySelector('.search-count');
    if (!countEl) {
        countEl = document.createElement('span');
        countEl.className = 'search-count';
        document.getElementById('search-input-wrap').insertBefore(countEl, document.getElementById('search-clear-btn'));
    }
    countEl.textContent = `${visible}/${total}`;
}

// ─── Animation Loop ───
// ─── Shelf scroll sound (Web Audio API) ───
let shelvdAudioCtx = null;
let lastFocusedBookIndex = -1;

function getAudioCtx() {
    if (!shelvdAudioCtx) {
        shelvdAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return shelvdAudioCtx;
}

function playTickSound() {
    try {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const now = ctx.currentTime;

        // Soft wood knock — like tapping a book spine
        const bufSize = ctx.sampleRate * 0.04;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.08));
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buf;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 800;
        bandpass.Q.value = 2;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        noise.connect(bandpass);
        bandpass.connect(gain);
        gain.connect(ctx.destination);

        noise.start(now);
        noise.stop(now + 0.04);
    } catch (e) { /* ignore audio errors */ }
}

function checkFocusedBook() {
    if (!camera || bookObjects.length === 0) return;

    const camY = camera.position.y;
    let closestIdx = -1;
    let closestDist = Infinity;

    for (let i = 0; i < bookObjects.length; i++) {
        const d = Math.abs(bookObjects[i].position.y - camY);
        if (d < closestDist) {
            closestDist = d;
            closestIdx = i;
        }
    }

    if (closestIdx !== -1 && closestIdx !== lastFocusedBookIndex) {
        if (lastFocusedBookIndex !== -1) playTickSound();
        lastFocusedBookIndex = closestIdx;
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();

    // Dust
    animateDust();

    // Interactive movement for pulled-out book
    if (pulledOutBook && pulledOutBook.userData.basePosition && camera) {
        const base = pulledOutBook.userData.basePosition;
        const maxOffset = 0.25;

        const cameraForward = new THREE.Vector3();
        camera.getWorldDirection(cameraForward);
        const cameraRight = new THREE.Vector3().crossVectors(cameraForward, camera.up).normalize();
        const cameraUp = camera.up.clone().normalize();

        const worldOffset = new THREE.Vector3()
            .addScaledVector(cameraRight, mousePosition.x * maxOffset)
            .addScaledVector(cameraUp, mousePosition.y * maxOffset);

        pulledOutBook.userData.targetPosition = {
            x: base.x + worldOffset.x,
            y: base.y + worldOffset.y,
            z: base.z + worldOffset.z
        };
    }

    // Animate all books
    const lerpFactor = 0.15;
    const norm = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

    bookObjects.forEach(book => {
        // Position animation
        if (book.userData.targetPosition) {
            const t = book.userData.targetPosition;
            const p = book.position;
            const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;

            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(dz) > 0.001) {
                p.x += dx * lerpFactor;
                p.y += dy * lerpFactor;
                p.z += dz * lerpFactor;
            } else {
                p.set(t.x, t.y, t.z);
                if (!book.userData.isPulledOut && book.userData.isStacked) {
                    delete book.userData.targetPosition;
                    if (book.userData.stackRotation) {
                        book.rotation.x = norm(book.userData.stackRotation.x);
                        book.rotation.y = norm(book.userData.stackRotation.y);
                        book.rotation.z = norm(book.userData.stackRotation.z || 0);
                    }
                    book.scale.set(1, 1, 1);
                }
            }
        }

        // Skip rotation for fully stacked books
        if (book.userData.isStacked && !book.userData.isPulledOut) {
            const hasAnim = book.userData.targetPosition !== undefined ||
                book.userData.targetRotation !== undefined ||
                book.userData.targetRotationX !== undefined ||
                book.userData.targetRotationZ !== undefined ||
                book.userData.targetScale !== undefined;
            if (!hasAnim) return;
        }

        // Y rotation
        if (book.userData.targetRotation !== undefined) {
            let cur = norm(book.rotation.y);
            let tgt = norm(book.userData.targetRotation);
            let diff = tgt - cur;
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.001) {
                book.rotation.y = norm(cur + diff * lerpFactor);
            } else {
                book.rotation.y = tgt;
                if (!book.userData.isPulledOut && book.userData.isStacked) {
                    delete book.userData.targetRotation;
                }
            }
        }

        // X rotation
        if (book.userData.targetRotationX !== undefined) {
            let cur = norm(book.rotation.x);
            let tgt = norm(book.userData.targetRotationX);
            let diff = tgt - cur;
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.001) {
                book.rotation.x = norm(cur + diff * lerpFactor);
            } else {
                book.rotation.x = tgt;
                if (!book.userData.isPulledOut && book.userData.isStacked) {
                    delete book.userData.targetRotationX;
                }
            }
        }

        // Z rotation
        if (book.userData.targetRotationZ !== undefined) {
            let cur = norm(book.rotation.z);
            let tgt = norm(book.userData.targetRotationZ);
            let diff = tgt - cur;
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.001) {
                book.rotation.z = norm(cur + diff * lerpFactor);
            } else {
                book.rotation.z = tgt;
                if (!book.userData.isPulledOut && book.userData.isStacked) {
                    delete book.userData.targetRotationZ;
                }
            }
        }

        // Scale animation
        if (book.userData.targetScale !== undefined) {
            const cur = book.scale.x;
            const tgt = book.userData.targetScale;
            const diff = tgt - cur;

            if (Math.abs(diff) > 0.001) {
                const s = cur + diff * lerpFactor;
                book.scale.set(s, s, s);
            } else {
                book.scale.set(tgt, tgt, tgt);
                if (!book.userData.isPulledOut && book.userData.isStacked) {
                    delete book.userData.targetScale;
                }
            }
        }
    });

    // Update scrollbar
    updateScrollbar();

    // Twinkle stars
    if (stars && starMaterial) {
        const t = performance.now() * 0.001;
        starMaterial.opacity = 0.3 + 0.2 * Math.sin(t * 0.5);
    }

    renderer.render(scene, camera);
}

// ─── Resize ───
function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// ─── Start ───
// Track app visit
if (window.shelvdTrack) shelvdTrack('app_visit');

// Wait for auth before starting
window.addEventListener('shelvd:authenticated', (e) => {
    const { username, isPublic } = e.detail || {};
    init(username, isPublic);
});

// Also start if no auth screen (direct access / dev)
if (!document.getElementById('auth-screen') ||
    document.getElementById('auth-screen').style.display === 'none') {
    const publicUsername = getPublicUsernameFromPath();
    init(publicUsername, Boolean(publicUsername));
}

// Listen for new books added via photo
window.addEventListener('shelvd:book-added', async (e) => {
    const { book, coverUrl, digitalCoverUrl } = e.detail;

    // Prefix Supabase ID to avoid collision with books.json IDs
    const safeId = `sb-${book.id}`;
    const bookData = {
        id: safeId,
        title: book.title,
        author: book.author || 'Unknown author',
        pages: book.pages || 250,
        cover: coverUrl || null,
        digital_cover_url: digitalCoverUrl || book.digital_cover_url || null,
        isbn_13: book.isbn_13 || null,
        isbn_10: book.isbn_10 || null,
        publisher: book.publisher || null,
        published_year: book.published_year || null,
        edition: book.edition || null,
        language: book.language || null,
        translator: book.translator || null,
        format: book.format || null,
        match_status: book.match_status || null
    };

    createBook(bookData, bookObjects.length);
    arrangeBooksInStack();

    // Expose updated bookObjects for import-export
    window.shelvdBookObjects = bookObjects;
    window.shelvdGetCoverCacheKey = getCoverCacheKey;
    document.getElementById('header-book-count').textContent = bookObjects.length + ' books';

    const finalCover = bookData.digital_cover_url || bookData.cover || null;
    if (bookData.digital_cover_url) {
        const cacheKey = getCoverCacheKey(bookData);
        coverCache[cacheKey] = bookData.digital_cover_url;
    }

    window.shelvdCoverCache = coverCache;
    try {
        localStorage.setItem('book-covers-cache', JSON.stringify(coverCache));
        localStorage.setItem('book-covers-version', 'v11-cover-lock');
    } catch (err) { /* ignore */ }

    if (finalCover) applyCoverToBook(safeId, finalCover);
});
