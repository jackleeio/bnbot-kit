'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useHomeTranslations } from '@/context/locale-context';

// 0 = "Brand & Bot" → 1 = "Boost & Bot" → 2 = "Boost N Bot" → 3 = "BNBot" → loop
type Phase = 0 | 1 | 2 | 3;

const Hero: React.FC = () => {
  const { t: tNew } = useHomeTranslations('home.newHome.hero');
  const [phase, setPhase] = useState<Phase>(0);

  useEffect(() => {
    const durations = [1500, 1500, 1500, 2500];
    const timer = setTimeout(() => {
      setPhase((prev) => ((prev + 1) % 4) as Phase);
    }, durations[phase]);
    return () => clearTimeout(timer);
  }, [phase]);

  const showLeft = phase !== 3;
  const merged = phase === 3;
  // Left word scroll: oost(0), rand(1), oost(2) — same pattern as middle char
  const [leftPos, setLeftPos] = useState(1); // start at rand
  const [leftNoTransition, setLeftNoTransition] = useState(false);
  const [mascotHover, setMascotHover] = useState(false);

  // Stack for middle char: N(0), &(1), N(2)
  const [scrollPos, setScrollPos] = useState(1);
  const [noTransition, setNoTransition] = useState(false);

  // Left word: Brand → Boost (phase 1), Boost stays (phase 2,3), reset to Brand (phase 0)
  useEffect(() => {
    if (phase === 1) {
      setLeftPos(0); // rand → oost: slide down (1→0)
      const t = setTimeout(() => {
        setLeftNoTransition(true);
        setLeftPos(2); // instant reset to bottom oost
        requestAnimationFrame(() => setLeftNoTransition(false));
      }, 400);
      return () => clearTimeout(t);
    } else if (phase === 0) {
      setLeftPos(1); // oost → rand: slide down (2→1)
    }
  }, [phase]);

  // Middle char: & → N (phase 2), reset to & (phase 0)
  useEffect(() => {
    if (phase === 2) {
      setScrollPos(0); // & → N: slide down (1→0)
      const t = setTimeout(() => {
        setNoTransition(true);
        setScrollPos(2);
        requestAnimationFrame(() => setNoTransition(false));
      }, 400);
      return () => clearTimeout(t);
    } else if (phase === 0) {
      setNoTransition(true);
      setScrollPos(1); // reset to &
      requestAnimationFrame(() => setNoTransition(false));
    }
  }, [phase]);

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-4 pt-16">
      <div className="pointer-events-none absolute -top-20 right-0 h-[500px] w-[500px] rounded-full bg-teal-500/[0.04] blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-20 left-0 h-[400px] w-[400px] rounded-full bg-teal-500/[0.03] blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 flex max-w-[780px] flex-col items-center text-center"
      >
        <div
          className="mb-8 cursor-pointer animate-float hover:[animation:none]"
          onMouseEnter={() => setMascotHover(true)}
          onMouseLeave={() => setMascotHover(false)}
        >
          <Image
            src="/icons/bnbot-new-logo.png"
            alt="BNBot"
            width={128}
            height={128}
            className={`h-16 w-16 transition-[filter,transform] duration-300 md:h-20 md:w-20 ${
              mascotHover
                ? 'scale-110 drop-shadow-[0_0_50px_rgba(0,229,204,0.5)] animate-[nod_0.5s_ease-in-out_infinite]'
                : 'drop-shadow-[0_0_30px_rgba(0,229,204,0.2)]'
            }`}
            priority
          />
        </div>

        {/* Title — ONE unified gradient, no transforms inside */}
        <h1
          className="animate-gradient-shift mb-5 flex items-center justify-center text-6xl font-bold md:text-[72px]"
          style={{
            background: 'linear-gradient(135deg, #f0f4ff 0%, #ff4d4d 52%, #00e5cc 100%)',
            backgroundSize: '200% 200%',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-2px',
          }}
        >
          B
          {/* "rand"/"oost" — slides down like the & → N animation */}
          <span style={{
            display: 'inline-block',
            maxWidth: showLeft ? '4em' : '0px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            transition: 'max-width 0.3s ease-in-out',
            verticalAlign: 'bottom',
          }}>
            <span style={{
              display: 'inline-block',
              height: '1.15em',
              overflow: 'hidden',
              verticalAlign: 'bottom',
            }}>
              <span style={{
                display: 'block',
                marginTop: `${-leftPos * 1.15}em`,
                transition: leftNoTransition ? 'none' : 'margin-top 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                lineHeight: '1.15em',
              }}>
                oost<br />rand<br />oost
              </span>
            </span>
          </span>
          {/* left space */}
          <span style={{ display: 'inline-block', width: merged ? '0.05em' : '0.2em', transition: 'width 0.3s ease-in-out' }} />

          {/* Middle char: top-to-bottom slide — &(0) → N(1) → &(2) then reset */}
          <span style={{
            display: 'inline-block',
            height: '1.15em',
            overflow: 'hidden',
            verticalAlign: 'bottom',
            width: '0.65em',
            textAlign: 'center',
          }}>
            <span style={{
              display: 'block',
              marginTop: `${-scrollPos * 1.15}em`,
              transition: noTransition ? 'none' : 'margin-top 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              lineHeight: '1.15em',
            }}>
              N<br />&<br />N
            </span>
          </span>

          {/* right space */}
          <span style={{ display: 'inline-block', width: merged ? '0.05em' : '0.2em', transition: 'width 0.3s ease-in-out' }} />
          Bot
        </h1>

        <p className={`mb-6 text-[10px] font-medium uppercase tracking-[2.5px] md:text-base transition-all duration-300 ${
          mascotHover ? 'text-teal-400 animate-[shake_0.4s_ease-in-out_3]' : 'text-coral-500'
        }`}>
          {mascotHover ? 'LFG! LFG!' : tNew('tagline')}
        </p>

        <p className="mt-4 max-w-[600px] text-center text-sm leading-relaxed text-space-muted md:text-[17px]">
          Your AI agent for personal branding. From trend discovery to viral content, all on autopilot.
        </p>

        <a
          href="#quickstart"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('quickstart')?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-coral-500 px-6 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-coral-400 hover:shadow-[0_0_30px_rgba(255,77,77,0.3)] md:px-8 md:py-3 md:text-base"
        >
          Get Started
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </a>

        <a
          href="https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-sm transition-all duration-300 hover:border-white/20 hover:bg-white/[0.08] md:gap-2.5 md:px-5 md:py-2.5"
        >
          <span className="rounded-full bg-coral-500 px-2 py-0.5 text-[9px] font-bold uppercase text-white md:px-2.5 md:text-[11px]">NEW</span>
          <span className="text-xs text-space-muted md:text-sm">BNBot Extension v0.7.1</span>
          <svg className="h-4 w-4 text-space-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7v10" />
          </svg>
        </a>
      </motion.div>
    </section>
  );
};

export default Hero;
