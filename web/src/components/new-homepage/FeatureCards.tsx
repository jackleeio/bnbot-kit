'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Fingerprint, RefreshCw, Bot, BarChart3, Wrench, ChevronDown } from 'lucide-react';
import SectionHeader from './SectionHeader';
import { useHomeTranslations } from '@/context/locale-context';

const features = [
  { icon: Globe, titleKey: 'platformTrends', descKey: 'platformTrendsDesc', accent: true },
  { icon: Fingerprint, titleKey: 'personalBrand', descKey: 'personalBrandDesc' },
  { icon: RefreshCw, titleKey: 'contentRepurpose', descKey: 'contentRepurposeDesc' },
  { icon: Bot, titleKey: 'agentAutomation', descKey: 'agentAutomationDesc' },
  { icon: BarChart3, titleKey: 'xAnalytics', descKey: 'xAnalyticsDesc' },
  { icon: Wrench, titleKey: 'smartTools', descKey: 'smartToolsDesc' },
];

const MobileCard: React.FC<{ f: typeof features[0]; t: (k: string) => string; i: number }> = ({ f, t, i }) => {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: i * 0.05 }}
      onClick={() => setOpen(!open)}
      className={`cursor-pointer rounded-xl border p-4 transition-all duration-200 ${
        f.accent
          ? 'border-coral-500/25 bg-gradient-to-r from-coral-500/[0.08] to-[rgba(10,15,26,0.65)]'
          : 'border-white/[0.08] bg-[rgba(10,15,26,0.65)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`inline-flex rounded-lg p-2 ${
          f.accent ? 'border border-coral-500/30 bg-coral-500/10 text-coral-400' : 'border border-coral-500/20 text-coral-500'
        }`}>
          <f.icon className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <h3 className="flex-1 text-sm font-semibold text-space-text">{t(f.titleKey)}</h3>
        <ChevronDown className={`h-4 w-4 text-space-dim transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <p className="mt-3 text-xs leading-relaxed text-space-muted">{t(f.descKey)}</p>
      )}
    </motion.div>
  );
};

const FeatureCards: React.FC = () => {
  const { t } = useHomeTranslations('home.featureCards');

  return (
    <section id="features" className="relative py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <SectionHeader title={t('title')} />
        </motion.div>

        {/* Mobile: collapsible list */}
        <div className="flex flex-col gap-2.5 md:hidden">
          {features.map((f, i) => <MobileCard key={f.titleKey} f={f} t={t} i={i} />)}
        </div>

        {/* Desktop: grid */}
        <div className="hidden gap-4 sm:grid-cols-2 md:grid lg:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.titleKey}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.07 }}
              className={`group relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${
                f.accent
                  ? 'border-coral-500/25 bg-gradient-to-br from-coral-500/[0.08] via-[rgba(10,15,26,0.65)] to-[rgba(10,15,26,0.65)] hover:border-coral-500/40 hover:shadow-[0_0_40px_rgba(255,77,77,0.1)]'
                  : 'border-white/[0.08] bg-[rgba(10,15,26,0.65)] hover:border-coral-500/20 hover:shadow-[0_0_30px_rgba(255,77,77,0.06)]'
              }`}
            >
              <div className={`mb-4 inline-flex rounded-xl p-3 transition-colors ${
                f.accent
                  ? 'border border-coral-500/30 bg-coral-500/10 text-coral-400'
                  : 'border border-coral-500/20 text-coral-500 group-hover:border-coral-500/40'
              }`}>
                <f.icon className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <h3 className="mb-2 text-base font-semibold text-space-text">{t(f.titleKey)}</h3>
              <p className="text-sm leading-relaxed text-space-muted">{t(f.descKey)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeatureCards;
