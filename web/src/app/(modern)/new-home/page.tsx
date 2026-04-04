'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  StarfieldBackground,
  NewNavbar,
  Hero,
  Integrations,
  QuickStart,
  FeatureCards,
  FeatureList,
  PlatformSupport,
  Pricing,
  Testimonials,
  Footer,
} from '@/components/new-homepage';
import ClassicLayout from '@/layouts/classic/layout';

export default function NewHomePage() {
  return (
    <ClassicLayout hideTopNav={true} contentClassName="!p-0 !bg-space-black">
      <style jsx global>{`html:not(.light-home), html:not(.light-home) body { background-color: #000000 !important; }`}</style>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen bg-space-black font-sans text-space-text selection:bg-coral-500/30"
      >
        <StarfieldBackground />
        <NewNavbar />

        <main className="relative z-10">
          <Hero />
          <QuickStart />
          <Integrations />
          <FeatureCards />
          <FeatureList />
          <PlatformSupport />
          {/* <Pricing /> */}
          <Testimonials />
        </main>

        <Footer />
      </motion.div>
    </ClassicLayout>
  );
}
