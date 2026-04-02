'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { StarfieldBackground, NewNavbar, Footer } from '@/components/new-homepage';
import DocsContent from '@/components/new-homepage/DocsContent';
import ClassicLayout from '@/layouts/classic/layout';

export default function DocsPageClient() {
  return (
    <ClassicLayout hideTopNav={true} contentClassName="!p-0 !bg-space-black">
      <style jsx global>{`html, body { background-color: #000000 !important; }`}</style>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen bg-space-black font-sans text-space-text selection:bg-coral-500/30"
      >
        <StarfieldBackground />
        <NewNavbar />

        <main className="relative z-10 pt-20">
          <DocsContent />
        </main>

        <Footer />
      </motion.div>
    </ClassicLayout>
  );
}
