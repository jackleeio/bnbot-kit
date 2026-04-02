'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import Image from 'next/image';
import SectionHeader from './SectionHeader';

const SKILL_URL = 'https://bnbot.ai/skill.md';
const CHROME_URL = 'https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln';

const SETUP_CMD = 'npx @bnbot/cli setup';

const QuickStart: React.FC = () => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(SETUP_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="quickstart" className="relative py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <SectionHeader title="Quick Start" />
        </motion.div>

        <motion.div className="mx-auto max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          {/* Mac-style terminal */}
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-space-surface">
            {/* Header: traffic lights + badge */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#FF5F56]" />
                <div className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
                <div className="h-3 w-3 rounded-full bg-[#27C93F]" />
              </div>
            </div>

            {/* Body */}
            <div className="relative px-5 py-6">
              <p className="mb-4 font-mono text-xs text-space-dim">
                # Works with{' '}
                <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Claude Code</a>,{' '}
                <a href="https://codex.openai.com" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Codex</a>,{' '}
                <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">OpenClaw</a>,{' '}
                <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Opencode</a> &{' '}
                <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Gemini CLI</a>.
              </p>

              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 font-mono text-sm">
                  <span className="text-coral-500">$ </span>
                  <span className="text-space-text">{SETUP_CMD}</span>
                </div>

                <button
                  onClick={handleCopy}
                  className="flex-shrink-0 rounded-md border border-white/[0.08] p-2 text-space-dim transition-colors hover:bg-white/[0.04] hover:text-space-muted"
                >
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Chrome Extension CTA */}
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-space-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-space-text">BNBot Chrome Extension</p>
              <p className="mt-0.5 text-xs text-space-dim">Auto-post, smart reply, and scrape trends from 30+ platforms.</p>
            </div>
            <a
              href={CHROME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg border border-coral-500/30 bg-coral-500/10 px-4 py-2 text-xs font-semibold text-coral-500 transition-all hover:bg-coral-500 hover:text-white"
            >
              <Image src="/icons/bnbot-new-logo-sm.png" alt="BNBot" width={16} height={16} className="h-4 w-4" />
              Install Extension
            </a>
          </div>

          {/* ClawMoney */}
          <div className="mt-6 flex flex-col items-center gap-1 text-center text-sm text-space-dim">
            <span>Already have an AI agent?</span>
            <span>
              <a
                href="https://clawmoney.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-coral-500 underline underline-offset-2 transition-colors hover:text-coral-400"
              >
                <Image src="/icons/clawmoney-logo.png" alt="" width={14} height={14} className="inline h-3.5 w-3.5" />
                Join ClawMoney
              </a>
            {' '}and start earning.
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default QuickStart;
