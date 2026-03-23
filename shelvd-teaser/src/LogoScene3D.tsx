import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";

// ── Bar data from SVG (scaled /100 for 3D units) ──
const BARS = [
  { w: 0.92, oy: 0.42, dx: -1.46, dy: 1.56, rot: -18 },
  { w: 0.72, oy: 0.61, dx:  1.56, dy: 1.74, rot:  16 },
  { w: 1.04, oy: 0.80, dx: -1.66, dy: 1.96, rot: -12 },
  { w: 0.72, oy: 0.99, dx:  1.46, dy: 2.14, rot:  10 },
  { w: 0.88, oy: 1.18, dx: -1.38, dy: 2.36, rot:  -8 },
];
const BAR_H = 0.14;
const BAR_D = 0.08;
const CENTER_OY = 0.80;
const HOLD = 15;
const STAGGER = 5;

// ── Physics matching shelvd-logo-motion.html exactly ──
function simBar(bar: typeof BARS[0], idx: number, frame: number) {
  const dir = idx % 2 === 0 ? -1 : 1;
  const local = frame - HOLD - idx * STAGGER;
  if (local <= 0) return { x: 0, y: 0, r: 0, opacity: 1 };

  let x = 0, y = 0, r = 0;
  let vx = dir * (0.54 + idx * 0.10);
  let vy = 0;
  let vr = dir * (18 + idx * 2.4);
  const dt = 1 / 30;

  for (let f = 0; f < local; f++) {
    vy += 17.80 * dt;       // gravity 1780/100
    vx *= 1 - 0.0018 * 16;  // drag
    vr *= 1 - 0.0022 * 16;  // angular drag
    x += vx * dt;
    y += vy * dt;
    r += vr * dt;
  }

  x = bar.dx < 0 ? Math.max(bar.dx, x) : Math.min(bar.dx, x);
  y = Math.min(bar.dy, y);
  r = bar.rot < 0 ? Math.max(bar.rot, r) : Math.min(bar.rot, r);

  const p = Math.min(1, y / bar.dy);
  const opacity = p < 0.42 ? 1 : Math.max(0, 1 - (p - 0.42) / 0.58);
  return { x, y, r, opacity };
}

// ── 3D Stars ──
const Stars3D: React.FC = () => {
  const geo = useMemo(() => {
    const count = 350;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 2] = -2 - Math.random() * 12;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  return (
    <points geometry={geo}>
      <pointsMaterial color={0xffffff} size={0.04} transparent opacity={0.5} sizeAttenuation />
    </points>
  );
};

// ── Single logo bar ──
const Bar: React.FC<{ bar: typeof BARS[0]; idx: number; frame: number }> = ({ bar, idx, frame }) => {
  const s = simBar(bar, idx, frame);

  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: 0xf5f0eb,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
  }), []);

  mat.opacity = s.opacity;

  return (
    <mesh
      position={[s.x, -(bar.oy - CENTER_OY) - s.y, 0]}
      rotation={[0, 0, -s.r * Math.PI / 180]}
      material={mat}
      castShadow
    >
      <boxGeometry args={[bar.w, BAR_H, BAR_D]} />
    </mesh>
  );
};

// ── Main logo scene ──
export const LogoScene3D: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [75, 90], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const textIn = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const canvasH = Math.round(height * 0.58);

  return (
    <div style={{ width: "100%", height: "100%", opacity: fadeIn * fadeOut }}>
      {/* 3D bars — top portion */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "58%" }}>
        <ThreeCanvas
          width={width}
          height={canvasH}
          camera={{ fov: 38, near: 0.1, far: 100, position: [0.12, 0.04, 2.8] }}
          style={{ width: "100%", height: "100%" }}
        >
          <ambientLight color={0xd4c4a8} intensity={0.9} />
          <directionalLight color={0xffe8cc} intensity={1.5} position={[4, 6, 5]} castShadow />
          <pointLight color={0xffd6a5} intensity={0.35} position={[-3, 4, 2]} />
          <pointLight color={0xe8d4ff} intensity={0.12} position={[0, -2, 3]} />
          <Stars3D />
          {BARS.map((bar, i) => <Bar key={i} bar={bar} idx={i} frame={frame} />)}
        </ThreeCanvas>
      </div>

      {/* Warm glow behind bars */}
      <div style={{
        position: "absolute", top: "22%", left: "50%",
        width: 520, height: 240,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(217,174,126,0.10) 0%, transparent 70%)",
        filter: "blur(50px)", pointerEvents: "none",
      }} />

      {/* Wordmark */}
      <div style={{
        position: "absolute", bottom: "24%", left: 0, right: 0,
        opacity: textIn, textAlign: "center",
      }}>
        <div>
          <span style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 700, fontSize: 163, color: "white",
            letterSpacing: "-0.055em",
          }}>S</span>
          <span style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontWeight: 500, fontSize: 163, color: "white",
            letterSpacing: "-0.055em",
          }}>helvd</span>
        </div>
        <div style={{
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: 24, fontWeight: 500,
          color: "rgba(255,255,255,0.38)",
          letterSpacing: "0.32em",
          textTransform: "uppercase" as const,
          marginTop: 8,
        }}>
          Personal Library
        </div>
      </div>
    </div>
  );
};
