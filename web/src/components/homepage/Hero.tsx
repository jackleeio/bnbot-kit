'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHomeTranslations } from '@/context/locale-context';

const Hero: React.FC = () => {
  const [index, setIndex] = useState(0);
  const { t } = useHomeTranslations('home.hero');

  const SLOGANS = [
    {
      line1: t('slogans.0.line1'),
      line2: t('slogans.0.line2'),
      gradientClass: 'from-gold-600 via-gold-500 to-yellow-400',
    },
    {
      line1: t('slogans.1.line1'),
      line2: t('slogans.1.line2'),
      gradientClass: 'from-green-600 via-emerald-500 to-teal-400', // Adjusted for 'money' theme
    },
    {
      line1: t('slogans.2.line1'),
      line2: t('slogans.2.line2'),
      gradientClass: 'from-blue-600 via-indigo-500 to-violet-400', // Adjusted for 'traffic' theme
    },
  ];

  useEffect(() => {
    // Mouse movement effect
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 40;
      const y = (e.clientY / window.innerHeight - 0.5) * 40;
      document.documentElement.style.setProperty('--hero-mouse-x', `${x}px`);
      document.documentElement.style.setProperty('--hero-mouse-y', `${y}px`);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % SLOGANS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative flex min-h-[80vh] flex-col overflow-hidden pb-20 pt-32 md:min-h-[80vh] md:pb-32 md:pt-60">
      {/* Background Blobs */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-full -translate-x-1/2 transition-transform duration-300 ease-out"
        style={{
          transform:
            'translate(calc(-50% + var(--hero-mouse-x, 0px) * -1.5), calc(var(--hero-mouse-y, 0px) * -1.5))',
        }}
      >
        <div className="animate-blob absolute left-1/4 top-20 h-72 w-72 rounded-full bg-gold-200/50 opacity-60 mix-blend-multiply blur-[80px] filter"></div>
        <div className="animate-blob animation-delay-2000 absolute right-1/4 top-40 h-96 w-96 rounded-full bg-slate-200/60 opacity-60 mix-blend-multiply blur-[80px] filter"></div>
        <div className="animate-blob animation-delay-4000 absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-yellow-100 opacity-60 mix-blend-multiply blur-[80px] filter"></div>
      </div>

      {/* Gradient Transition to Next Section */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-0 h-32 bg-gradient-to-b from-transparent to-slate-50/50"></div>

      {/* Interactive X Background */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
        {/* Large X Logo */}
        <svg
          viewBox="0 0 1200 1227"
          className="h-[35vw] w-[35vw] select-none blur-sm transition-transform duration-75 ease-out"
          style={{
            transform:
              'translate(var(--hero-mouse-x, 0px), var(--hero-mouse-y, 0px))',
          }}
        >
          <path
            fill="rgba(226, 232, 240, 0.5)"
            d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z"
          />
        </svg>
      </div>

      <div className="relative z-10 flex w-full flex-col items-center px-4 text-center sm:px-6 lg:px-8">
        {/* Top Badge */}
        <div className="animate-fade-in-up mb-10 inline-flex cursor-default select-none items-center gap-1.5 rounded-full border border-blue-100 bg-white px-4 py-1.5 shadow-[0_4px_20px_-4px_rgba(59,130,246,0.1)] transition-transform duration-300 hover:scale-105">
          <div className="flex text-amber-400">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2L14.4 7.2L20 9.6L14.4 12L12 17.2L9.6 12L4 9.6L9.6 7.2L12 2Z" />
              <path
                d="M19 15L20.2 17.4L23 18.6L20.2 19.8L19 22.2L17.8 19.8L15 18.6L17.8 17.4L19 15Z"
                opacity="0.7"
              />
              <path
                d="M5 16L6.2 18.4L9 19.6L6.2 20.8L5 23.2L3.8 20.8L1 19.6L3.8 18.4L5 16Z"
                opacity="0.7"
              />
            </svg>
          </div>
          <span className="text-sm font-medium tracking-tight text-slate-700">
            {t('badge')}
          </span>
        </div>

        <div className="relative mb-6 h-36 w-full md:h-40">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={index}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{
                duration: 0.6,
                ease: [0.16, 1, 0.3, 1],
                exit: { duration: 0.2, ease: 'easeIn' },
              }}
              className="absolute inset-0 flex w-full flex-col items-center justify-center"
            >
              <h1 className="whitespace-nowrap text-center text-4xl font-extrabold tracking-tight text-slate-900 md:text-7xl">
                {SLOGANS[index].line1}
                <br />
                <span
                  className={`bg-gradient-to-r bg-clip-text text-transparent ${SLOGANS[index].gradientClass} text-glow`}
                >
                  {SLOGANS[index].line2}
                </span>
              </h1>
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="mx-auto mb-16 mt-2 max-w-4xl text-base text-slate-600 md:text-lg">
          {t('subtitle')}
        </p>

        {/* CTA & Social Proof */}
        <div className="flex w-full flex-col items-center gap-24">
          <button
            onClick={() => {
              window.open(
                'https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln',
                '_blank',
              );
            }}
            className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-12 py-3.5 text-lg font-bold text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] ring-4 ring-orange-400/20 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(239,68,68,0.6)]"
          >
            {t('cta')}
          </button>

          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-white bg-slate-200"
                  >
                    <img
                      src={`https://i.pravatar.cc/100?img=${i + 10}`}
                      alt="User"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-start">
                <div className="flex text-amber-400">{'★'.repeat(5)}</div>
                <span className="text-xs font-medium text-slate-500">
                  {t('socialProof')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-6 text-[10px] font-medium tracking-wider text-slate-500">
              <span>{t('stats.traffic')}</span>
              <span>{t('stats.earnings')}</span>
              <span>{t('stats.platform')}</span>
            </div>
          </div>

          {/* <div className="mt-8 flex flex-col items-center gap-4">
            <p className="text-slate-400 font-medium tracking-wide text-sm">Trusted by leading social media managers</p>
            <div className="flex items-center gap-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.186 2c-5.556 0-10.063 4.418-10.063 10.155 0 2.298.78 4.43 2.1 6.136l-.993 3.619 3.655-1.018c1.64.992 3.551 1.56 5.592 1.56 5.555 0 10.063-4.417 10.063-10.154C22.54 6.55 18.032 2 12.186 2zM12.15 18.84c-1.587 0-3.085-.453-4.38-1.24l-2.43.682.66-2.433c-.86-1.34-1.353-2.92-1.353-4.6 0-4.665 3.593-8.455 8.017-8.455 4.425 0 8.016 3.79 8.016 8.455.001 4.665-3.592 8.455-8.016 8.455z"></path></svg>
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clipRule="evenodd"></path></svg>
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M23.193 7.879c0-5.206-3.411-6.732-3.411-6.732C18.062.298 15.482 0 12.041 0h-.066c-3.44 0-6.02.298-7.74 1.147 0 0-3.411 1.526-3.411 6.732 0 1.192-.023 2.618.015 4.129.124 5.092.934 10.109 5.641 11.355 2.17.574 4.034.695 5.535.612 2.722-.15 4.25-.972 4.25-.972l-.09-1.975s-1.945.613-4.129.539c-2.165-.074-4.449-.233-4.799-2.891a5.499 5.499 0 0 1-.048-.745s2.125.52 4.817.643c1.646.075 3.19-.097 4.758-.283 3.007-.359 5.625-2.212 5.954-3.905.517-2.665.475-6.507.475-6.507zm-4.024 6.709h-2.497V8.469c0-1.29-.543-1.944-1.628-1.944-1.2 0-1.802.776-1.802 2.312v3.349h-2.483v-3.35c0-1.536-.602-2.312-1.802-2.312-1.085 0-1.628.655-1.628 1.944v6.119H4.832V8.28c0-2.184 1.178-3.272 3.535-3.272 1.652 0 2.955.855 3.639 2.56.634-1.705 1.986-2.56 3.639-2.56 2.357 0 3.535 1.088 3.535 3.272v6.307z"></path></svg>
            </div>
          </div> */}
        </div>
      </div>
    </div>
  );
};

export default Hero;
