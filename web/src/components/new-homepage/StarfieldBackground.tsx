'use client';

import React, { useMemo } from 'react';

const StarfieldBackground: React.FC = () => {
  // Generate stars client-side only to avoid hydration mismatch
  const { small, medium, large } = useMemo(() => {
    const seeded = (i: number) => Math.abs(((Math.sin(i * 9301 + 49297) * 233280) % 1));
    const gen = (count: number, size: number) => {
      const s: string[] = [];
      for (let i = 0; i < count; i++) {
        const x = Math.round(seeded(i * 3 + size) * 10000) / 100;
        const y = Math.round(seeded(i * 7 + size * 2) * 10000) / 100;
        const o = Math.round((0.4 + seeded(i * 11 + size) * 0.5) * 100) / 100;
        s.push(`${x}vw ${y}vh 0 ${size - 1}px rgba(255,255,255,${o})`);
      }
      return s.join(',');
    };
    return { small: gen(200, 1), medium: gen(60, 2), large: gen(12, 3) };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" suppressHydrationWarning>
      {/* Stars */}
      <div className="absolute inset-0 animate-twinkle" style={{ boxShadow: small }} suppressHydrationWarning />
      <div className="absolute inset-0 animate-twinkle" style={{ boxShadow: medium, animationDelay: '-4s' }} suppressHydrationWarning />
      <div className="absolute inset-0 animate-twinkle" style={{ boxShadow: large, animationDelay: '-2s', animationDuration: '12s' }} suppressHydrationWarning />

      {/* Nebula glow - top right */}
      <div className="absolute -top-[200px] -right-[100px] h-[800px] w-[800px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,77,77,0.12) 0%, rgba(255,77,77,0.05) 40%, transparent 70%)' }}
      />

      {/* Nebula glow - bottom left */}
      <div className="absolute -bottom-[300px] -left-[200px] h-[700px] w-[700px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,100,100,0.08) 0%, rgba(255,77,77,0.03) 40%, transparent 70%)' }}
      />

      {/* Nebula glow - center top */}
      <div className="absolute top-[10%] left-1/2 h-[500px] w-[1200px] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(255,77,77,0.06) 0%, rgba(200,50,50,0.02) 50%, transparent 80%)' }}
      />

      {/* Deep space ambient warm tint */}
      <div className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 70% 20%, rgba(255,60,60,0.04) 0%, transparent 60%), radial-gradient(ellipse at 30% 80%, rgba(255,80,80,0.03) 0%, transparent 50%)' }}
      />

      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(5,8,16,0.5)_100%)]" />
    </div>
  );
};

export default StarfieldBackground;
