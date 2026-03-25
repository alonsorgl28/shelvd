import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── State ───
let scene, camera, renderer, controls;
let bookMeshes = [];
let animId = null;
let raycaster, mouse;
let hoveredMesh = null;
let onClickCallback = null;

const GLOBE_RADIUS = 5;
const BOOK_W = 0.55;
const BOOK_H = 0.82;

// Even distribution of points on a sphere
function fibonacciSphere(n) {
    const points = [];
    const phi = Math.PI * (Math.sqrt(5) - 1);
    for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i;
        points.push(new THREE.Vector3(
            Math.cos(theta) * r,
            y,
            Math.sin(theta) * r
        ));
    }
    return points;
}

function makeColorTexture(title) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    const hue = ((title.charCodeAt(0) || 0) * 17 + (title.charCodeAt(1) || 0) * 31) % 360;
    ctx.fillStyle = `hsl(${hue}, 35%, 22%)`;
    ctx.fillRect(0, 0, 128, 192);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    const words = title.split(' ');
    let line = '';
    let y = 88;
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > 112) {
            ctx.fillText(line, 64, y);
            line = word;
            y += 17;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, 64, y);
    return new THREE.CanvasTexture(canvas);
}

export function initGlobe(containerEl, books, getVisibleCoverUrl, onBookClick) {
    onClickCallback = onBookClick;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, containerEl.clientWidth / containerEl.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 13);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
    renderer.setClearColor(0x000000, 0);
    containerEl.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    const n = books.length;
    const positions = n > 1 ? fibonacciSphere(n) : [new THREE.Vector3(0, 0, 1)];
    const loader = new THREE.TextureLoader();

    books.forEach((book, i) => {
        const pos = positions[i].clone().multiplyScalar(GLOBE_RADIUS);
        const geo = new THREE.PlaneGeometry(BOOK_W, BOOK_H);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.FrontSide });
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.copy(pos);
        // Face outward from sphere center
        mesh.lookAt(pos.clone().multiplyScalar(2));
        mesh.userData.bookData = book;
        scene.add(mesh);
        bookMeshes.push(mesh);

        const coverUrl = getVisibleCoverUrl(book);
        if (coverUrl) {
            loader.load(
                coverUrl,
                (tex) => { mat.map = tex; mat.needsUpdate = true; },
                undefined,
                () => { mat.map = makeColorTexture(book.title || '?'); mat.needsUpdate = true; }
            );
        } else {
            mat.map = makeColorTexture(book.title || '?');
            mat.needsUpdate = true;
        }
    });

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onMouseClick);
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('resize', onWindowResize);

    animate();
}

function onMouseMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    updateHover();
}

function onMouseClick() {
    if (hoveredMesh && onClickCallback) {
        onClickCallback(hoveredMesh.userData.bookData);
    }
}

function onTouchEnd(e) {
    if (!e.changedTouches.length || !renderer) return;
    const t = e.changedTouches[0];
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(bookMeshes);
    if (hits.length > 0 && onClickCallback) {
        onClickCallback(hits[0].object.userData.bookData);
    }
}

function updateHover() {
    if (!raycaster || !camera) return;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(bookMeshes);
    if (hoveredMesh) {
        hoveredMesh.scale.setScalar(1);
        hoveredMesh = null;
    }
    if (hits.length > 0) {
        hoveredMesh = hits[0].object;
        hoveredMesh.scale.setScalar(1.14);
        renderer.domElement.style.cursor = 'pointer';
    } else {
        renderer.domElement.style.cursor = '';
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
    renderer.render(scene, camera);
}

export function destroyGlobe(containerEl) {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (renderer) {
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('click', onMouseClick);
        renderer.domElement.removeEventListener('touchend', onTouchEnd);
        if (containerEl.contains(renderer.domElement)) {
            containerEl.removeChild(renderer.domElement);
        }
        renderer.dispose();
        renderer = null;
    }
    bookMeshes.forEach(m => {
        m.geometry.dispose();
        if (m.material.map) m.material.map.dispose();
        m.material.dispose();
    });
    bookMeshes = [];
    hoveredMesh = null;
    window.removeEventListener('resize', onWindowResize);
    scene = null;
    camera = null;
    controls = null;
}
