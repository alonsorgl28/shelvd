import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { LogoScene3D } from "./LogoScene3D";
import { BookStack3D } from "./BookStack3D";

const NAVY = "#0a0f1a";

// ── HTML Stars (visible behind transparent areas) ──
const Stars: React.FC = () => {
  const stars = React.useMemo(() => {
    const s = [];
    for (let i = 0; i < 200; i++) {
      s.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.4 + 0.1,
        delay: Math.random() * 3,
      });
    }
    return s;
  }, []);

  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      {stars.map((s, i) => {
        const twinkle = Math.sin((frame / 30 + s.delay) * Math.PI) * 0.3 + 0.7;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              borderRadius: "50%",
              backgroundColor: `rgba(255,255,255,${s.opacity * twinkle})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ── Main composition ──
export const ShelvdTeaser: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: NAVY }}>
      <Stars />

      {/* Scene 1: Logo bars scatter (0–90) */}
      <Sequence from={0} durationInFrames={90}>
        <LogoScene3D />
      </Sequence>

      {/* Scene 2: Book cascade + CTA (85–300) */}
      <Sequence from={85} durationInFrames={215}>
        <BookStack3D />
      </Sequence>
    </AbsoluteFill>
  );
};
