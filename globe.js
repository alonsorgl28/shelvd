import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── State ───
let scene, camera, renderer, controls;
let globeMeshes = [];   // { mesh, basePos }
let animId = null;
let raycaster, mouse;
let hoveredEntry = null;
let resumeTimer = null;
let onClickCallback = null;

const GLOBE_RADIUS = 5.5;
const HOVER_PUSH = 0.35; // outward displacement on hover

// ─── Fibonacci sphere — even distribution ───
function fibonacciSphere(n) {
    const pts = [];
    const phi = Math.PI * (Math.sqrt(5) - 1);
    for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const t = phi * i;
        pts.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
    }
    return pts;
}

// ─── Stable upright orientation on sphere surface ───
// Makes +Z face outward from center, +Y roughly world-up
function orientOnSphere(mesh, pos) {
    const outward = pos.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(outward.dot(up)) > 0.95) up.set(0, 0, 1); // degenerate at poles
    const right = up.clone().cross(outward).normalize();
    const trueUp = outward.clone().cross(right).normalize();
    mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right, trueUp, outward)
    );
}

// ─── Stars ───
function addStars(sc) {
    const count = 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i * 3]     = (Math.random() - 0.5) * 90;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 90;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sc.add(new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xffffff, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.6
    })));
}

// ─── Public API ───

/**
 * @param {HTMLElement} containerEl
 * @param {Array} books  — raw bookData objects
 * @param {Function} getVisibleCoverUrl  — (bookData) => url | null
 * @param {Function} makeBookMesh        — (bookData) => THREE.Mesh with BoxGeometry + 6 materials
 * @param {Function} applyCover          — (mesh, coverUrl) => void — applies cover texture async
 * @param {Function} onBookClick         — (bookData) => void
 */
export function initGlobe(containerEl, books, getVisibleCoverUrl, makeBookMesh, applyCover, onBookClick) {
    onClickCallback = onBookClick;

    // ── Scene ──
    scene = new THREE.Scene();
    addStars(scene);

    // ── Camera ──
    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.position.set(0, 0, 14);

    // ── Renderer ──
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    containerEl.appendChild(renderer.domElement);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xfff5e0, 0.6);
    dir.position.set(8, 12, 10);
    scene.add(dir);

    // ── Controls ──
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.5;   // can enter the globe
    controls.maxDistance = 22;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Pause auto-rotate on drag, resume 3s after releasing
    controls.addEventListener('start', () => {
        controls.autoRotate = false;
        if (resumeTimer) clearTimeout(resumeTimer);
    });
    controls.addEventListener('end', () => {
        resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
    });

    // ── Raycaster ──
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2(9999, 9999); // off-screen until first move

    // ── Place books on sphere ──
    const n = books.length;
    const positions = n > 1 ? fibonacciSphere(n) : [new THREE.Vector3(0, 0, 1)];

    books.forEach((book, i) => {
        const mesh = makeBookMesh(book);
        const pos = positions[i].clone().multiplyScalar(GLOBE_RADIUS);
        mesh.position.copy(pos);
        orientOnSphere(mesh, pos);
        mesh.userData.basePos = pos.clone();
        scene.add(mesh);
        globeMeshes.push(mesh);

        const coverUrl = getVisibleCoverUrl(book);
        if (coverUrl) applyCover(mesh, coverUrl);
    });

    // ── Events ──
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onMouseClick);
    window.addEventListener('resize', onWindowResize);

    animate();
}

export function destroyGlobe(containerEl) {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (renderer) {
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('click', onMouseClick);
        if (containerEl.contains(renderer.domElement)) containerEl.removeChild(renderer.domElement);
        renderer.dispose();
        renderer = null;
    }
    globeMeshes.forEach(m => {
        m.geometry.dispose();
        if (Array.isArray(m.material)) {
            m.material.forEach(mat => { if (mat.map) mat.map.dispose(); mat.dispose(); });
        }
    });
    globeMeshes = [];
    hoveredEntry = null;
    window.removeEventListener('resize', onWindowResize);
    scene = null; camera = null; controls = null;
}

// ─── Internal ───

function onMouseMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}

function onMouseClick() {
    if (hoveredEntry && onClickCallback) {
        onClickCallback(hoveredEntry.mesh.userData.bookData);
    }
}

function updateHover() {
    if (!raycaster || !camera) return;
    raycaster.setFromCamera(mouse, camera);
    const meshList = globeMeshes;
    const hits = raycaster.intersectObjects(meshList, false);

    const newHit = hits.length > 0 ? hits[0].object : null;

    // Restore previous hovered book
    if (hoveredEntry && hoveredEntry.mesh !== newHit) {
        hoveredEntry.mesh.position.copy(hoveredEntry.basePos);
        hoveredEntry = null;
        renderer.domElement.style.cursor = '';
    }

    // Apply hover to new book
    if (newHit && !hoveredEntry) {
        const basePos = newHit.userData.basePos;
        const outward = basePos.clone().normalize();
        newHit.position.copy(basePos.clone().addScaledVector(outward, HOVER_PUSH));
        hoveredEntry = { mesh: newHit, basePos: basePos.clone() };
        renderer.domElement.style.cursor = 'pointer';
    }
}

function onWindowResize() {
    if (!renderer || !camera) return;
    const el = renderer.domElement.parentElement;
    if (!el) return;
    camera.aspect = el.clientWidth / el.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(el.clientWidth, el.clientHeight);
}

function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    updateHover();
    renderer.render(scene, camera);
}
