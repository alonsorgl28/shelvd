import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// ── Color gen (same as app.js) ──
function genColor(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  const s = 25 + Math.abs((hash >> 8) % 30);
  const l = 35 + Math.abs((hash >> 16) % 25);
  const s1 = s / 100, l1 = l / 100;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return (Math.round(255 * f(0)) << 16) | (Math.round(255 * f(8)) << 8) | Math.round(255 * f(4));
}

// ── Book data ──
const RAW_BOOKS = [
  { title: "Cien años de soledad", author: "García Márquez", pages: 417 },
  { title: "1984", author: "George Orwell", pages: 328 },
  { title: "El principito", author: "Saint-Exupéry", pages: 96 },
  { title: "Rayuela", author: "Julio Cortázar", pages: 600 },
  { title: "Don Quijote", author: "Cervantes", pages: 863 },
  { title: "Ficciones", author: "Borges", pages: 174 },
  { title: "Pedro Páramo", author: "Juan Rulfo", pages: 124 },
  { title: "Fahrenheit 451", author: "Ray Bradbury", pages: 158 },
  { title: "Crimen y castigo", author: "Dostoyevski", pages: 671 },
  { title: "Maus", author: "Art Spiegelman", pages: 296 },
  { title: "La náusea", author: "Sartre", pages: 253 },
  { title: "Principles", author: "Ray Dalio", pages: 592 },
  { title: "The Great Gatsby", author: "Fitzgerald", pages: 180 },
  { title: "White Noise", author: "Don DeLillo", pages: 326 },
  { title: "Beloved", author: "Toni Morrison", pages: 324 },
].sort((a, b) => a.title.localeCompare(b.title, "es"));

const TOTAL = RAW_BOOKS.length;
const BOOK_W = 2.0;
const BOOK_D = 0.06;
const GAP = 0.02;
const HOLD = 20;
const STAG = 3;

// Pre-compute scatter targets + physics params per book
const BOOKS = RAW_BOOKS.map((b, i) => {
  const dir = i % 2 === 0 ? -1 : 1;
  const spineW = Math.min(0.35, Math.max(0.08, b.pages * 0.0004));
  const scatterOrder = TOTAL - 1 - i; // top book scatters first
  return {
    ...b,
    color: genColor(b.title),
    spineW,
    scatterOrder,
    dx: dir * (1.8 + Math.sin(i * 2.7 + 1.3) * 0.5 + 0.2),
    dy: 1.5 + Math.sin(i * 3.1 + 0.7) * 0.3 + 0.2,
    rot: dir * (14 + Math.sin(i * 1.9 + 2.1) * 5),
    vx0: dir * (0.55 + Math.sin(i * 4.1) * 0.12 + 0.08),
    vr0: dir * (13 + Math.sin(i * 2.3) * 3.5),
  };
});

// ── Spine texture (horizontal text, matching app.js style) ──
function createSpineTex(
  title: string, author: string, pages: number,
  spineW: number, color: number
): THREE.CanvasTexture {
  const aspect = BOOK_W / spineW;
  const cW = 4096;
  const cH = Math.max(256, Math.round(cW / aspect));

  const canvas = document.createElement("canvas");
  canvas.width = cW;
  canvas.height = cH;
  const ctx = canvas.getContext("2d")!;

  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, bl = color & 0xff;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, cH);
  grad.addColorStop(0, `rgb(${r},${g},${bl})`);
  grad.addColorStop(1, `rgb(${Math.max(0, r - 25)},${Math.max(0, g - 25)},${Math.max(0, bl - 25)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cW, cH);

  // Top accent line
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, cW, Math.max(2, cH * 0.05));

  // Bottom band
  const bandH = Math.max(3, Math.round(cH * 0.08));
  ctx.fillStyle = `rgb(${Math.max(0, r - 45)},${Math.max(0, g - 45)},${Math.max(0, bl - 45)})`;
  ctx.fillRect(0, cH - bandH, cW, bandH);

  // Text colors
  const lum = (r * 0.299 + g * 0.587 + bl * 0.114) / 255;
  const tc = lum > 0.45 ? "#000000" : "#ffffff";
  const ta = lum > 0.45 ? 0.85 : 0.92;
  const sa = lum > 0.45 ? 0.5 : 0.55;
  const ty = cH * 0.47;

  // Title — monospace uppercase bold
  const titleText = title.toUpperCase();
  let fs = Math.min(cH * 0.55, 180);
  ctx.font = `700 ${fs}px "Menlo", "Consolas", "Courier New", monospace`;
  let m = ctx.measureText(titleText);
  if (m.width > cW * 0.55) {
    fs = Math.max(20, Math.floor(fs * cW * 0.55 / m.width));
    ctx.font = `700 ${fs}px "Menlo", "Consolas", "Courier New", monospace`;
    m = ctx.measureText(titleText);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = tc;
  ctx.globalAlpha = ta;
  ctx.fillText(titleText, cW * 0.03, ty);

  // Separator
  const sx = cW * 0.03 + m.width + cW * 0.018;
  ctx.globalAlpha = lum > 0.45 ? 0.15 : 0.2;
  ctx.fillStyle = tc;
  ctx.fillRect(sx, cH * 0.22, 3, cH * 0.56);

  // Author
  const afs = Math.max(16, fs * 0.5);
  ctx.font = `400 ${afs}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = tc;
  ctx.globalAlpha = sa;
  ctx.fillText(author.toUpperCase(), sx + cW * 0.015, ty);

  // Page count
  if (pages) {
    const pfs = Math.max(14, fs * 0.32);
    ctx.font = `300 ${pfs}px "Menlo", monospace`;
    ctx.globalAlpha = sa * 0.6;
    ctx.textAlign = "right";
    ctx.fillText(`${pages}p`, cW * 0.97, ty);
  }

  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// ── Physics (same engine as logo — scatter + fall + fade) ──
function simBook(book: typeof BOOKS[0], frame: number) {
  const local = frame - HOLD - book.scatterOrder * STAG;
  if (local <= 0) return { x: 0, y: 0, r: 0, opacity: 1 };

  let x = 0, y = 0, r = 0;
  let vx = book.vx0;
  let vy = 0;
  let vr = book.vr0;
  const dt = 1 / 30;

  for (let f = 0; f < local; f++) {
    vy += 17.80 * dt;       // gravity 1780/100
    vx *= 1 - 0.0018 * 16;  // drag
    vr *= 1 - 0.0022 * 16;  // angular drag
    x += vx * dt;
    y += vy * dt;
    r += vr * dt;
  }

  x = book.dx < 0 ? Math.max(book.dx, x) : Math.min(book.dx, x);
  y = Math.min(book.dy, y);
  r = book.rot < 0 ? Math.max(book.rot, r) : Math.min(book.rot, r);

  const p = Math.min(1, y / book.dy);
  const opacity = p < 0.42 ? 1 : Math.max(0, 1 - (p - 0.42) / 0.58);
  return { x, y, r, opacity };
}

// ── 3D Stars ──
const Stars3D: React.FC = () => {
  const geo = useMemo(() => {
    const count = 400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 25 - 5;
      pos[i * 3 + 2] = -3 - Math.random() * 15;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  return (
    <points geometry={geo}>
      <pointsMaterial color={0xffffff} size={0.05} transparent opacity={0.5} sizeAttenuation />
    </points>
  );
};

// ── Single falling book ──
const FallingBook: React.FC<{
  book: typeof BOOKS[0]; stackY: number; frame: number;
}> = ({ book, stackY, frame }) => {
  const s = simBook(book, frame);

  const tex = useMemo(
    () => createSpineTex(book.title, book.author, book.pages, book.spineW, book.color),
    [book.title, book.author, book.pages, book.spineW, book.color]
  );

  const solidMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: book.color,
    roughness: 0.7,
    metalness: 0.03,
    transparent: true,
  }), [book.color]);

  const spineMat = useMemo(() => new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.6,
    metalness: 0.03,
    transparent: true,
  }), [tex]);

  // Update opacity each frame
  solidMat.opacity = s.opacity;
  spineMat.opacity = s.opacity;

  const materials = useMemo(
    () => [solidMat, solidMat, solidMat, solidMat, spineMat, solidMat],
    [solidMat, spineMat]
  );

  return (
    <mesh
      position={[s.x, stackY - s.y, 0]}
      rotation={[0, 0, -s.r * Math.PI / 180]}
      material={materials}
      castShadow
    >
      <boxGeometry args={[BOOK_W, book.spineW, BOOK_D]} />
    </mesh>
  );
};

// ── Camera with subtle push-in ──
const Cam: React.FC<{ frame: number; cy: number }> = ({ frame, cy }) => {
  const { camera } = useThree();

  const z = interpolate(frame, [0, 215], [4.8, 4.0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const yDrift = interpolate(frame, [0, 215], [0, 0.25], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  React.useLayoutEffect(() => {
    camera.position.set(0.2, cy - yDrift, z);
    camera.lookAt(0, cy, 0);
    camera.updateProjectionMatrix();
  }, [camera, cy, yDrift, z]);

  return null;
};

// ── Main book cascade scene ──
export const BookStack3D: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Stack positions (bottom-up)
  const stackData = useMemo(() => {
    let y = 0;
    return BOOKS.map((b) => {
      const pos = y + b.spineW / 2;
      y += b.spineW + GAP;
      return { ...b, stackY: pos };
    });
  }, []);

  const totalH = stackData.reduce((a, b) => a + b.spineW + GAP, 0);
  const centerY = totalH / 2;

  // Fade in/out
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [80, 100], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  // Wordmark
  const wmIn = interpolate(frame, [95, 120], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const wmY = interpolate(frame, [95, 120], [25, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* 3D scene */}
      <div style={{ width: "100%", height: "100%", opacity: fadeIn * fadeOut }}>
        <ThreeCanvas
          width={width}
          height={height}
          camera={{ fov: 50, near: 0.1, far: 100, position: [0.2, centerY, 4.8] }}
          style={{ width: "100%", height: "100%" }}
        >
          {/* Warm 3-point lighting */}
          <ambientLight color={0xd4c4a8} intensity={0.9} />
          <directionalLight color={0xffe8cc} intensity={1.4} position={[5, 8, 6]} castShadow />
          <pointLight color={0xffd6a5} intensity={0.35} position={[-4, 6, 3]} />
          <pointLight color={0xe8d4ff} intensity={0.15} position={[2, -3, 4]} />

          <Stars3D />
          <Cam frame={frame} cy={centerY} />

          {stackData.map((b, i) => (
            <FallingBook key={i} book={b} stackY={b.stackY} frame={frame} />
          ))}
        </ThreeCanvas>
      </div>

      {/* Final wordmark */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        opacity: wmIn, transform: `translateY(${wmY}px)`,
        pointerEvents: "none",
      }}>
        <div>
          <span style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 700, fontSize: 130, color: "white",
            letterSpacing: "-0.055em",
          }}>S</span>
          <span style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 500, fontSize: 130, color: "white",
            letterSpacing: "-0.055em",
          }}>helvd</span>
        </div>
        <div style={{
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: 22, fontWeight: 400,
          color: "rgba(255,255,255,0.4)",
          letterSpacing: "-0.02em",
          marginTop: 16,
        }}>
          Your books, beautifully stacked.
        </div>
        <div style={{
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: 16, fontWeight: 400,
          color: "rgba(255,255,255,0.25)",
          marginTop: 8,
        }}>
          shelvd.app
        </div>
      </div>
    </div>
  );
};
