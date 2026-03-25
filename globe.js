import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── State ───
let scene, camera, renderer, controls;
let entries = [];      // { mesh, basePos, outsideQuat, insideQuat, flipT }
let animId = null;
let raycaster, mouse;
let hoveredMesh = null;
let selectedEntry = null;
let selectedAnimT = 0;       // 0 = on sphere, 1 = pulled to camera
let isInsideGlobe = false;
let resumeTimer = null;
let onClickCallback = null;
let onDeselectCallback = null;

const GLOBE_RADIUS = 5.5;
const HOVER_PUSH   = 0.32;
const FLIP_SPEED   = 3.0;    // higher = faster flip
const PULL_SPEED   = 4.0;    // selected book animation speed
const PULL_SCALE   = 2.4;    // scale when pulled out
const DIM_OPACITY  = 0.28;

// ─── Fibonacci sphere ───
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

// ─── Orientation helpers ───
function buildOutwardQuat(pos) {
    const outward = pos.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(outward.dot(up)) > 0.95) up.set(0, 0, 1);
    const right  = up.clone().cross(outward).normalize();
    const trueUp = outward.clone().cross(right).normalize();
    const q = new THREE.Quaternion();
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, trueUp, outward));
    return q;
}

function buildInwardQuat(outsideQuat) {
    // Flip 180° around the book's local Y axis → cover now faces inward
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    return outsideQuat.clone().multiply(flip);
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
        color: 0xffffff, size: 0.07, sizeAttenuation: true,
        transparent: true, opacity: 0.55
    })));
}

// ─── Set book opacity (all 6 materials) ───
function setBookOpacity(mesh, opacity) {
    if (!Array.isArray(mesh.material)) return;
    mesh.material.forEach(m => {
        m.transparent = true;
        m.opacity = opacity;
        m.needsUpdate = true;
    });
}

// ─── Target position for selected book (in front of camera) ───
function getSelectedTargetPos() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    return camera.position.clone().addScaledVector(dir, 3.5);
}

// ─── Public API ───

/**
 * @param {HTMLElement}  containerEl
 * @param {Array}        books              — raw bookData objects
 * @param {Function}     getVisibleCoverUrl — (bookData) => url | null
 * @param {Function}     makeBookMesh       — (bookData) => THREE.Mesh
 * @param {Function}     applyCover         — (mesh, url) => void
 * @param {Function}     onBookClick        — (bookData) => void  — called on select
 * @param {Function}     onBookDeselect     — () => void          — called on deselect
 */
export function initGlobe(containerEl, books, getVisibleCoverUrl,
                           makeBookMesh, applyCover,
                           onBookClick, onBookDeselect) {
    onClickCallback    = onBookClick;
    onDeselectCallback = onBookDeselect;

    // ── Scene ──
    scene = new THREE.Scene();
    addStars(scene);

    // ── Camera ──
    const w = containerEl.clientWidth, h = containerEl.clientHeight;
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.position.set(0, 0, 14);

    // ── Renderer ──
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    containerEl.appendChild(renderer.domElement);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xfff5e0, 0.55);
    dir.position.set(8, 12, 10);
    scene.add(dir);

    // ── Controls ──
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.06;
    controls.enablePan      = false;
    controls.minDistance    = 0.5;   // can enter the globe
    controls.maxDistance    = 22;
    controls.autoRotate     = true;
    controls.autoRotateSpeed = 0.5;

    controls.addEventListener('start', () => {
        controls.autoRotate = false;
        if (resumeTimer) clearTimeout(resumeTimer);
        // Deselect on any drag start
        if (selectedEntry) deselectBook();
    });
    controls.addEventListener('end', () => {
        resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
    });

    // ── Raycaster ──
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2(9999, 9999);

    // ── Place books on sphere ──
    const n = books.length;
    const positions = n > 1 ? fibonacciSphere(n) : [new THREE.Vector3(0, 0, 1)];

    books.forEach((book, i) => {
        const mesh = makeBookMesh(book);
        const pos  = positions[i].clone().multiplyScalar(GLOBE_RADIUS);

        const outsideQuat = buildOutwardQuat(pos);
        const insideQuat  = buildInwardQuat(outsideQuat);

        mesh.position.copy(pos);
        mesh.quaternion.copy(outsideQuat);
        mesh.userData.basePos = pos.clone();
        scene.add(mesh);

        entries.push({ mesh, basePos: pos.clone(), outsideQuat, insideQuat, flipT: 0 });

        const coverUrl = getVisibleCoverUrl(book);
        if (coverUrl) applyCover(mesh, coverUrl);
    });

    // ── Events ──
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onPointerClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onWindowResize);

    animate();
}

export function destroyGlobe(containerEl) {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (renderer) {
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('click', onPointerClick);
        if (containerEl.contains(renderer.domElement)) containerEl.removeChild(renderer.domElement);
        renderer.dispose();
        renderer = null;
    }
    entries.forEach(e => {
        e.mesh.geometry.dispose();
        if (Array.isArray(e.mesh.material)) {
            e.mesh.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        }
    });
    entries = [];
    hoveredMesh = null;
    selectedEntry = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onWindowResize);
    scene = null; camera = null; controls = null;
}

// ─── Selection ───

function selectBook(entry) {
    if (selectedEntry === entry) return;
    if (selectedEntry) restoreEntry(selectedEntry);

    selectedEntry  = entry;
    selectedAnimT  = 0;
    controls.autoRotate = false;
    if (resumeTimer) clearTimeout(resumeTimer);

    // Dim all other books
    entries.forEach(e => {
        if (e !== entry) setBookOpacity(e.mesh, DIM_OPACITY);
    });

    if (onClickCallback) onClickCallback(entry.mesh.userData.bookData);
}

function deselectBook() {
    if (!selectedEntry) return;
    restoreEntry(selectedEntry);
    selectedEntry = null;
    selectedAnimT = 0;

    entries.forEach(e => setBookOpacity(e.mesh, 1.0));
    if (onDeselectCallback) onDeselectCallback();
}

function restoreEntry(entry) {
    entry.mesh.position.copy(entry.basePos);
    entry.mesh.scale.setScalar(1);
    setBookOpacity(entry.mesh, 1.0);
}

// ─── Events ───

function onMouseMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}

function onPointerClick(e) {
    // Small movement threshold to not fire on drag end
    if (!raycaster || !camera) return;
    raycaster.setFromCamera(mouse, camera);
    const meshList = entries.map(en => en.mesh);
    const hits = raycaster.intersectObjects(meshList, false);

    if (hits.length === 0) {
        deselectBook();
        return;
    }

    const hitMesh = hits[0].object;
    const entry   = entries.find(en => en.mesh === hitMesh);
    if (!entry) return;

    if (selectedEntry === entry) {
        deselectBook();
    } else {
        selectBook(entry);
    }
}

function onKeyDown(e) {
    if (e.key === 'Escape' && selectedEntry) deselectBook();
}

function onWindowResize() {
    if (!renderer || !camera) return;
    const el = renderer.domElement.parentElement;
    if (!el) return;
    camera.aspect = el.clientWidth / el.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(el.clientWidth, el.clientHeight);
}

// ─── Animate ───

let lastTime = 0;

function animate(time = 0) {
    animId = requestAnimationFrame(animate);
    const dt = Math.min((time - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = time;

    controls.update();

    // ── Detect inside/outside ──
    const camDist = camera.position.length();
    const wasInside = isInsideGlobe;
    isInsideGlobe = camDist < GLOBE_RADIUS;

    // ── Flip all books ──
    const flipTarget = isInsideGlobe ? 1 : 0;
    entries.forEach(entry => {
        if (selectedEntry === entry) return; // skip selected book

        // Lerp flipT
        const diff = flipTarget - entry.flipT;
        if (Math.abs(diff) > 0.001) {
            entry.flipT += diff * FLIP_SPEED * dt;
            entry.flipT  = Math.max(0, Math.min(1, entry.flipT));
        }

        // Slerp quaternion
        entry.mesh.quaternion.slerpQuaternions(entry.outsideQuat, entry.insideQuat, entry.flipT);

        // Hover displacement (only when not selected)
        if (hoveredMesh === entry.mesh) {
            const outward = entry.basePos.clone().normalize();
            entry.mesh.position.copy(entry.basePos.clone().addScaledVector(outward, HOVER_PUSH));
        } else {
            entry.mesh.position.copy(entry.basePos);
        }
    });

    // ── Animate selected book toward camera ──
    if (selectedEntry) {
        selectedAnimT = Math.min(1, selectedAnimT + PULL_SPEED * dt);
        const t = easeOutCubic(selectedAnimT);

        const target = getSelectedTargetPos();
        selectedEntry.mesh.position.lerpVectors(selectedEntry.basePos, target, t);
        selectedEntry.mesh.scale.setScalar(THREE.MathUtils.lerp(1, PULL_SCALE, t));

        // Keep cover facing camera when pulled
        selectedEntry.mesh.quaternion.slerpQuaternions(
            isInsideGlobe ? selectedEntry.insideQuat : selectedEntry.outsideQuat,
            getCameraFacingQuat(),
            t
        );
    }

    // ── Hover (disabled while a book is selected) ──
    if (!selectedEntry) updateHover();

    renderer.render(scene, camera);
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Quaternion that makes a book face the camera head-on
function getCameraFacingQuat() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // Book's +Z should point opposite to camera's looking direction
    // (so the cover faces the camera)
    const toCamera = dir.clone().negate();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(toCamera.dot(up)) > 0.95) up.set(0, 0, 1);
    const right  = up.clone().cross(toCamera).normalize();
    const trueUp = toCamera.clone().cross(right).normalize();
    const q = new THREE.Quaternion();
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, trueUp, toCamera));
    return q;
}

function updateHover() {
    if (!raycaster || !camera || !renderer) return;
    raycaster.setFromCamera(mouse, camera);
    const meshList = entries.map(e => e.mesh);
    const hits = raycaster.intersectObjects(meshList, false);
    const newHit = hits.length > 0 ? hits[0].object : null;

    if (hoveredMesh && hoveredMesh !== newHit) {
        hoveredMesh = null;
        renderer.domElement.style.cursor = '';
    }
    if (newHit && hoveredMesh !== newHit) {
        hoveredMesh = newHit;
        renderer.domElement.style.cursor = 'pointer';
    }
}
