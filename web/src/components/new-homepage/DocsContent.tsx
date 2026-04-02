'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

// --- Reusable components ---

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex-shrink-0 rounded-lg border border-coral-500/30 bg-coral-500/10 px-3 py-1.5 text-xs font-medium text-coral-500 transition-all hover:bg-coral-500 hover:text-white"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function CommandBlock({ label, command }: { label?: string; command: string }) {
  return (
    <div>
      {label && (
        <p className="mb-1.5 text-xs font-medium text-space-dim">{label}</p>
      )}
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-space-black px-3 py-3 sm:px-4">
        <span className="font-mono text-xs text-coral-500">$</span>
        <code className="min-w-0 flex-1 overflow-hidden truncate font-mono text-xs text-space-text">
          {command}
        </code>
        <CopyButton text={command} />
      </div>
    </div>
  );
}

// --- Table of Contents ---

const sections = [
  { id: 'what-is-bnbot', label: 'What is BNBot' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'features', label: 'Features' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'faq', label: 'FAQ' },
];

function TableOfContents({ activeId }: { activeId: string }) {
  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <nav className="space-y-1">
      <p className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-space-dim">On this page</p>
      {sections.map((s) => (
        <button
          key={s.id}
          onClick={() => handleClick(s.id)}
          className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
            activeId === s.id
              ? 'bg-coral-500/10 font-medium text-coral-500'
              : 'text-space-muted hover:text-space-text'
          }`}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}

// --- FAQ ---

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left"
      >
        <span className="text-base font-semibold text-space-text">{q}</span>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-space-dim transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <p className="pb-5 text-sm leading-relaxed text-space-muted">{a}</p>
      )}
    </div>
  );
}

// --- Main Component ---

export default function DocsContent() {
  const [activeId, setActiveId] = useState(sections[0].id);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveId(id);
            }
          });
        },
        { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero banner */}
      <div className="relative mb-10 overflow-hidden rounded-2xl border border-coral-500/10 bg-gradient-to-r from-coral-500/5 via-coral-500/10 to-coral-500/5 px-6 py-8">
        <span className="font-mono text-xs font-medium text-coral-500">{'>'} DOCS</span>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-space-text">
          Documentation
        </h1>
        <p className="mt-2 max-w-md text-space-muted">
          Everything you need to get started with BNBot.
        </p>
      </div>

      {/* Layout: sidebar + content */}
      <div className="flex gap-10">
        {/* Left sidebar — desktop only */}
        <aside className="hidden w-56 flex-shrink-0 lg:block">
          <div className="sticky top-24">
            <TableOfContents activeId={activeId} />
          </div>
        </aside>

        {/* Right content */}
        <div ref={contentRef} className="min-w-0 flex-1 space-y-16">
          {/* What is BNBot */}
          <section id="what-is-bnbot" className="scroll-mt-24">
            <span className="font-mono text-xs font-medium text-coral-500">{'>'} OVERVIEW</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-space-text">
              What is BNBot
            </h2>
            <div className="mt-4 space-y-4 text-sm leading-relaxed text-space-muted">
              <p>
                BNBot is your <strong className="text-space-text">AI-powered personal branding agent</strong>.
                It discovers trends across 30+ platforms, generates viral content, and automates
                social media management — all on autopilot.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  {
                    title: 'Chrome Extension',
                    desc: 'Browser-based automation for X/Twitter — auto-post, smart reply, trend scraping, and content repurposing with human-like behavior.',
                  },
                  {
                    title: 'CLI Tool',
                    desc: 'Terminal-first interface that works with Claude Code, Codex, OpenClaw, Opencode, and Gemini CLI. One command to set up.',
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-space-surface p-5">
                    <h4 className="text-sm font-bold text-space-text">{item.title}</h4>
                    <p className="mt-1.5 text-xs leading-relaxed text-space-muted">{item.desc}</p>
                  </div>
                ))}
              </div>
              <p>
                BNBot integrates with the{' '}
                <a href="https://clawmoney.ai" target="_blank" rel="noopener noreferrer" className="text-coral-500 hover:underline">ClawMoney</a> attention
                marketplace, allowing your AI agent to earn crypto by engaging with and promoting content
                on X/Twitter and other platforms.
              </p>
            </div>
          </section>

          {/* Getting Started */}
          <section id="getting-started" className="scroll-mt-24">
            <span className="font-mono text-xs font-medium text-coral-500">{'>'} QUICKSTART</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-space-text">
              Getting Started
            </h2>
            <p className="mt-3 text-sm text-space-muted">
              Two ways to get started — pick the one that fits your workflow.
            </p>

            {/* Option 1: CLI */}
            <div className="mt-8 max-w-2xl">
              <h3 className="mb-4 text-lg font-semibold text-space-text">Option 1: CLI Setup</h3>
              <div className="relative">
                <div className="pointer-events-none absolute -inset-px rounded-2xl bg-coral-500/10 blur-xl" />
                <div className="relative rounded-t-2xl border border-coral-500/25 bg-space-surface px-5 pb-4 pt-4 shadow-lg sm:px-6 sm:pb-5 sm:pt-5">
                  <div className="mb-3 flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-coral-500/40" />
                    <div className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                    <div className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-space-black px-4 py-4">
                    <span className="mt-0.5 select-none font-mono text-sm text-coral-500/60">{'>'}</span>
                    <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-space-text sm:text-sm">
                      npx @bnbot/cli setup
                    </code>
                    <CopyButton text="npx @bnbot/cli setup" />
                  </div>
                </div>
              </div>

              <div className="relative mt-[-1px]">
                <div className="rounded-b-2xl border border-t-0 border-coral-500/25 bg-space-surface px-5 pb-5 pt-3 sm:px-6">
                  <ol className="space-y-2">
                    <li className="flex items-baseline gap-2.5 text-sm text-space-muted">
                      <span className="font-bold text-coral-500">1.</span>
                      Run the setup command — it configures your agent environment
                    </li>
                    <li className="flex items-baseline gap-2.5 text-sm text-space-muted">
                      <span className="font-bold text-coral-500">2.</span>
                      Connect your X/Twitter account for posting and analytics
                    </li>
                    <li className="flex items-baseline gap-2.5 text-sm text-space-muted">
                      <span className="font-bold text-coral-500">3.</span>
                      Start discovering trends and creating content with AI
                    </li>
                  </ol>
                </div>
              </div>

              <p className="mt-4 text-xs text-space-dim">
                Works with{' '}
                <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Claude Code</a>,{' '}
                <a href="https://codex.openai.com" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Codex</a>,{' '}
                <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">OpenClaw</a>,{' '}
                <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Opencode</a> &{' '}
                <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" className="text-space-muted underline underline-offset-2 hover:text-space-text">Gemini CLI</a>.
              </p>
            </div>

            {/* Option 2: Extension */}
            <div className="mt-10 max-w-2xl">
              <h3 className="mb-4 text-lg font-semibold text-space-text">Option 2: Chrome Extension</h3>
              <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-space-surface px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-space-text">BNBot Chrome Extension</p>
                  <p className="mt-0.5 text-xs text-space-dim">Auto-post, smart reply, trend scraping, and content repurposing from 30+ platforms.</p>
                </div>
                <a
                  href="https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-coral-500/30 bg-coral-500/10 px-4 py-2 text-xs font-semibold text-coral-500 transition-all hover:bg-coral-500 hover:text-white"
                >
                  <Image src="/icons/bnbot-new-logo-sm.png" alt="BNBot" width={16} height={16} className="h-4 w-4" />
                  Install Extension
                </a>
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="scroll-mt-24">
            <span className="font-mono text-xs font-medium text-coral-500">{'>'} FEATURES</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-space-text">
              Features
            </h2>
            <p className="mt-3 text-sm text-space-muted">
              Core capabilities of the BNBot platform.
            </p>

            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {[
                {
                  icon: (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 003 12c0-1.605.42-3.113 1.157-4.418" />
                    </svg>
                  ),
                  title: 'Platform Trend Discovery',
                  desc: 'Scrape and analyze trends from 30+ platforms including X, YouTube, TikTok, Reddit, Hacker News, and more — all in real time.',
                },
                {
                  icon: (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  ),
                  title: 'Personal Brand Building',
                  desc: 'AI analyzes your voice, audience, and niche to generate on-brand content that grows your following authentically.',
                },
                {
                  icon: (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
                    </svg>
                  ),
                  title: 'Content Repurposing',
                  desc: 'Transform content across formats — turn YouTube videos into tweet threads, TikToks into blog posts, podcasts into articles.',
                },
                {
                  icon: (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                    </svg>
                  ),
                  title: 'AI Agent Automation',
                  desc: 'Autonomous AI agents that post, reply, and engage 24/7. Works with Claude Code, Codex, OpenClaw, and more.',
                },
                {
                  icon: (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                  ),
                  title: 'X/Twitter Analytics',
                  desc: 'Deep analytics for your X account — track engagement, follower growth, best posting times, and content performance.',
                },
                {
                  icon: (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1h12.76M4.5 12c0-4.136 3.364-7.5 7.5-7.5s7.5 3.364 7.5 7.5-3.364 7.5-7.5 7.5" />
                    </svg>
                  ),
                  title: 'ClawMoney Integration',
                  desc: 'Connect to ClawMoney to earn crypto by engaging with and promoting content. Earnings settled on-chain via XID/XMoney.',
                },
              ].map((feature) => (
                <div key={feature.title} className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-space-surface p-8 transition-all hover:border-coral-500/20 hover:shadow-[0_0_30px_rgba(255,77,77,0.06)]">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-coral-500/20 bg-coral-500/10 text-coral-500">
                    {feature.icon}
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-space-text">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-space-muted">{feature.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Platforms */}
          <section id="platforms" className="scroll-mt-24">
            <span className="font-mono text-xs font-medium text-coral-500">{'>'} PLATFORMS</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-space-text">
              Supported Platforms
            </h2>
            <p className="mt-3 text-sm text-space-muted">
              30+ platforms supported across CLI and Chrome Extension.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { name: 'X / Twitter', source: 'Both', highlight: true },
                { name: 'YouTube', source: 'Both' },
                { name: 'TikTok', source: 'Both' },
                { name: 'Instagram', source: 'Both' },
                { name: 'Reddit', source: 'Both' },
                { name: 'LinkedIn', source: 'Extension' },
                { name: 'Hacker News', source: 'CLI' },
                { name: 'GitHub', source: 'CLI' },
                { name: 'Product Hunt', source: 'CLI' },
                { name: 'WeChat', source: 'Both' },
                { name: 'Xiaohongshu', source: 'Both' },
                { name: 'Bilibili', source: 'Both' },
              ].map((p) => (
                <div
                  key={p.name}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                    p.highlight
                      ? 'border-coral-500/25 bg-gradient-to-r from-coral-500/[0.08] to-space-surface'
                      : 'border-white/[0.06] bg-white/[0.02]'
                  }`}
                >
                  <span className="text-sm font-medium text-space-text">{p.name}</span>
                  {p.source === 'Both' ? (
                    <div className="flex gap-1">
                      <span className="rounded-full bg-teal-400/10 px-2 py-0.5 text-[10px] font-medium text-teal-400">CLI</span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-space-muted">Ext</span>
                    </div>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      p.source === 'CLI' ? 'bg-teal-400/10 text-teal-400' : 'bg-white/[0.06] text-space-muted'
                    }`}>
                      {p.source}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-space-dim">
              And 18+ more including Threads, Medium, Google, Facebook, Weibo, Zhihu, and RSS feeds.{' '}
              <a href="/" className="text-coral-500 hover:underline">See full list →</a>
            </p>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-24">
            <span className="font-mono text-xs font-medium text-coral-500">{'>'} FAQ</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-space-text">
              Frequently Asked Questions
            </h2>

            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-space-surface px-6 sm:px-8">
              <FAQItem
                q="What's the difference between the CLI and the Chrome Extension?"
                a="The CLI is a terminal tool that integrates with AI coding agents (Claude Code, Codex, etc.) for automated content workflows. The Chrome Extension runs in your browser for direct X/Twitter interactions like auto-posting, smart replies, and scraping trends from platforms that require login."
              />
              <FAQItem
                q="Is BNBot free to use?"
                a="BNBot offers a free tier with basic features. Advanced features like auto-posting, analytics, and AI agent automation require a subscription. Check the pricing page for details."
              />
              <FAQItem
                q="How does ClawMoney integration work?"
                a="Once you connect BNBot with ClawMoney, your AI agent can automatically engage with promoted content and earn crypto rewards. Earnings from X/Twitter are settled via XID/XMoney (sent to your X username), while other platform earnings go directly to your wallet."
              />
              <FAQItem
                q="Which AI agents are supported?"
                a="BNBot works with Claude Code, Codex, OpenClaw, Opencode, and Gemini CLI. Any agent that can run terminal commands can use the BNBot CLI."
              />
              <FAQItem
                q="Will using BNBot get my X account banned?"
                a="BNBot's Chrome Extension uses human-like browser automation to minimize detection risk. It operates within your actual browser session with natural timing and behavior patterns, unlike traditional bots that use APIs directly."
              />
              <FAQItem
                q="How many platforms does BNBot support?"
                a="BNBot supports 30+ platforms including X/Twitter, YouTube, TikTok, Instagram, Reddit, LinkedIn, Hacker News, GitHub, Product Hunt, WeChat, Xiaohongshu, Bilibili, and many more. Video downloads support 1000+ sites via yt-dlp."
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
