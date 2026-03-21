import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── State ───
let scene, camera, renderer, controls;
let raycaster, mouse;
let bookObjects = [];
let pulledOutBook = null;
let mousePosition = { x: 0, y: 0 };
let currentView = 'shelf'; // 'shelf' | 'grid'
let coverCache = {}; // title → coverUrl

const container = document.getElementById('library-3d-container');

// ─── Init ───
async function init() {
    const booksData = await fetch('books.json').then(r => r.json());

    // Scene — deep navy ink
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1a);
    scene.fog = new THREE.Fog(0x0a0f1a, 6, 14); // subtle depth fade

    // Camera
    const isMobile = window.innerWidth <= 768;
    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    const initialDistance = isMobile ? 2.5 : 1.85;
    camera.position.set(initialDistance, 5, 0);
    camera.lookAt(0, 5, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    controls.update();

    // Lighting — warm desk lamp feel
    const ambient = new THREE.AmbientLight(0xc8b8a0, 0.4); // warm ambient, slightly dimmer
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffe4c4, 0.9); // warm peach key light
    dirLight.position.set(8, 12, 5);
    dirLight.castShadow = true;
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

    const pointLight = new THREE.PointLight(0xffd6a5, 0.25); // warm fill from opposite side
    pointLight.position.set(-10, 10, -10);
    scene.add(pointLight);

    // Dust particles
    createDustParticles();

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

    // Hide loading
    document.getElementById('library-loading').style.display = 'none';

    // Show scrollbar
    document.getElementById('stack-scrollbar').classList.add('visible');

    // Events
    setupEventListeners();
    setupScrollbar();
    setupViewToggle();

    // Animation loop
    animate();

    window.addEventListener('resize', onResize);
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
    const materials = [];
    for (let i = 0; i < 6; i++) {
        if (i === 0 || i === 2 || i === 3) {
            // White pages/edges — matte
            materials[i] = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 1.0,
                metalness: 0.0
            });
        } else {
            materials[i] = new THREE.MeshStandardMaterial({
                color: defaultColor,
                roughness: 1.0,
                metalness: 0.0
            });
        }
    }

    // Create spine text texture immediately
    const spineTexture = createSpineTexture(bookData.title, bookData.author, bookData.pages, baseHeight, bookSpineWidth, defaultColor);
    materials[1] = new THREE.MeshStandardMaterial({
        map: spineTexture,
        roughness: 1.0,
        metalness: 0.0
    });

    const geometry = new THREE.BoxGeometry(baseCoverWidth, baseHeight, bookSpineWidth);
    const mesh = new THREE.Mesh(geometry, materials);

    mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

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
    const baseResolution = 2048;
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
    const darkerBg = `rgb(${Math.max(0, bgRgb.r - 25)},${Math.max(0, bgRgb.g - 25)},${Math.max(0, bgRgb.b - 25)})`;

    const grad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    grad.addColorStop(0, bgHex);
    grad.addColorStop(1, darkerBg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // ── Bottom band (8% height) ──
    const bandHeight = Math.round(canvasHeight * 0.08);
    const bandColor = `rgb(${Math.max(0, bgRgb.r - 45)},${Math.max(0, bgRgb.g - 45)},${Math.max(0, bgRgb.b - 45)})`;
    ctx.fillStyle = bandColor;
    ctx.fillRect(0, canvasHeight - bandHeight, canvasWidth, bandHeight);

    // ── Top accent line (2px) ──
    ctx.fillStyle = `rgba(255,255,255,0.12)`;
    ctx.fillRect(0, 0, canvasWidth, 2);

    // ── Auto-contrast: light text on dark bg, dark text on light bg ──
    const luminance = (bgRgb.r * 0.299 + bgRgb.g * 0.587 + bgRgb.b * 0.114) / 255;
    const textColor = luminance > 0.45 ? '#000000' : '#ffffff';
    const textAlpha = luminance > 0.45 ? 0.85 : 0.92;
    const subtextAlpha = luminance > 0.45 ? 0.5 : 0.55;
    const lineAlpha = luminance > 0.45 ? 0.15 : 0.2;

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

// ─── Dust Particles ───
let dustParticles;
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
    // Load from localStorage cache (v2 = with Google Books fallback)
    const CACHE_VERSION = 'v2';
    try {
        const ver = localStorage.getItem('book-covers-version');
        if (ver === CACHE_VERSION) {
            const cached = localStorage.getItem('book-covers-cache');
            if (cached) coverCache = JSON.parse(cached);
        } else {
            // Invalidate old cache to retry missing covers with new sources
            localStorage.removeItem('book-covers-cache');
            localStorage.setItem('book-covers-version', CACHE_VERSION);
        }
    } catch (e) { /* ignore */ }

    for (const bookData of booksData) {
        const cacheKey = `${bookData.title}|${bookData.author}`;
        if (coverCache[cacheKey]) {
            applyCoverToBook(bookData.id, coverCache[cacheKey]);
            continue;
        }

        const coverUrl = await fetchCoverWithFallbacks(bookData.title, bookData.author);
        if (coverUrl) {
            coverCache[cacheKey] = coverUrl;
            applyCoverToBook(bookData.id, coverUrl);
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 120));
    }

    // Save cache
    try {
        localStorage.setItem('book-covers-cache', JSON.stringify(coverCache));
    } catch (e) { /* ignore */ }
}

async function fetchCoverWithFallbacks(title, author) {
    // Strategy 1: Open Library (good for English titles)
    const olCover = await fetchOpenLibraryCover(title, author);
    if (olCover) return olCover;

    // Strategy 2: Google Books API (better for Spanish/international)
    const gbCover = await fetchGoogleBooksCover(title, author);
    if (gbCover) return gbCover;

    // Strategy 3: Open Library with title only (broader match)
    const olTitleOnly = await fetchOpenLibraryCover(title, null);
    if (olTitleOnly) return olTitleOnly;

    return null;
}

async function fetchOpenLibraryCover(title, author) {
    try {
        const query = author
            ? encodeURIComponent(`${title} ${author}`)
            : encodeURIComponent(title);
        const resp = await fetch(`https://openlibrary.org/search.json?q=${query}&limit=1&fields=cover_i`);
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
        const resp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`);
        const data = await resp.json();

        if (data.items && data.items[0]) {
            const info = data.items[0].volumeInfo;
            if (info.imageLinks) {
                // Prefer largest available, upgrade to zoom=2
                const url = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail;
                if (url) {
                    // Google Books URLs: replace zoom=1 with zoom=2 for better quality
                    // and ensure HTTPS
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
    if (!book) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = function () {
        const imageAspectRatio = img.width / img.height;
        const bookHeight = book.userData.baseHeight;
        const bookCoverWidth = bookHeight * imageAspectRatio;
        const spineWidth = book.userData.bookSpineWidth;

        // Update geometry with correct aspect ratio
        book.geometry.dispose();
        book.geometry = new THREE.BoxGeometry(bookCoverWidth, bookHeight, spineWidth);

        // Extract dominant color
        getDominantColor(img, function (color) {
            const hexColor = parseInt(color.replace('#', '0x'));
            book.userData.dominantColor = hexColor;

            // Update non-cover/non-white faces
            for (let i = 0; i < 6; i++) {
                if (i !== 4 && i !== 0 && i !== 2 && i !== 3 && book.material[i]) {
                    book.material[i].color.setHex(hexColor);
                }
                if ((i === 0 || i === 2 || i === 3) && book.material[i]) {
                    book.material[i].color.setHex(0xffffff);
                }
            }

            // Update spine texture with dominant color
            const spineTexture = createSpineTexture(
                book.userData.bookData.title,
                book.userData.bookData.author,
                book.userData.bookData.pages,
                bookHeight, spineWidth, color
            );
            book.material[1] = new THREE.MeshStandardMaterial({
                map: spineTexture, roughness: 1.0, metalness: 0.0
            });
        });

        // Cover texture
        const texture = new THREE.Texture(img);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.generateMipmaps = true;
        texture.needsUpdate = true;

        book.material[4] = new THREE.MeshStandardMaterial({
            map: texture, roughness: 1.0, metalness: 0.0
        });
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
}

// ─── Event Handlers ───
function setupEventListeners() {
    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('mousemove', onMouseMoveTrack);
    window.addEventListener('mousemove', onMouseMoveTrack);

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

        // Tap to select
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && duration < 300) {
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

    thumb.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging || !window.stackBounds) return;
        const rect = scrollbar.getBoundingClientRect();
        const trackTop = rect.top;
        const trackHeight = rect.height - thumb.offsetHeight;
        const pct = Math.max(0, Math.min(1, (e.clientY - trackTop) / trackHeight));

        // Scroll inverted: top of scrollbar = top of stack, bottom = bottom
        const targetY = window.stackBounds.top - pct * window.stackBounds.height;
        controls.target.y = targetY;
        camera.position.y = targetY;
        controls.update();
    });

    window.addEventListener('mouseup', () => { isDragging = false; });
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
    const containerEl = document.getElementById('library-3d-container');
    const scrollbar = document.getElementById('stack-scrollbar');

    if (view === 'grid') {
        containerEl.style.display = 'none';
        scrollbar.classList.remove('visible');
        gridEl.style.display = 'block';
        renderGridView();
    } else {
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
        const cacheKey = `${b.title}|${b.author}`;
        const coverUrl = coverCache[cacheKey];
        const coverHtml = coverUrl
            ? `<img src="${coverUrl}" alt="${b.title}" loading="lazy">`
            : `<div class="placeholder">${b.title}</div>`;
        return `
            <div class="grid-book" style="animation-delay: ${i * 20}ms" data-book-id="${b.id}">
                <div class="grid-book-cover">${coverHtml}</div>
                <div class="grid-book-info">
                    <div class="grid-book-title">${b.title}</div>
                    <div class="grid-book-author">${b.author}</div>
                </div>
            </div>`;
    }).join('')}</div>`;

    // Click handler for grid books
    gridEl.querySelectorAll('.grid-book').forEach(el => {
        el.addEventListener('click', () => {
            const bookId = parseInt(el.dataset.bookId);
            // Switch to shelf and pull out
            document.querySelector('.view-toggle input[value="shelf"]').checked = true;
            switchView('shelf');
            const book = bookObjects.find(b => b.userData.bookId === bookId);
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

// ─── Animation Loop ───
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
init();
