'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import SectionHeader from './SectionHeader';

interface Platform {
  name: string;
  commands: string[];
  source: 'CLI' | 'Extension' | 'Both';
}

const platforms: Platform[] = [
  { name: 'X', commands: ['trending', 'timeline', 'bookmarks', 'search', 'profile', 'thread', 'post', 'reply', 'like', 'retweet', 'follow', 'unfollow', 'bookmark', 'quote', 'delete', 'article', 'scheduled-post', 'auto-reply', 'notifications', 'analytics', 'download'], source: 'Both' },
  { name: 'YouTube', commands: ['search', 'trending', 'video', 'transcript', 'download', 'repurpose'], source: 'Both' },
  { name: 'TikTok', commands: ['explore', 'search', 'video', 'download', 'repurpose'], source: 'Both' },
  { name: 'Instagram', commands: ['explore', 'search', 'profile', 'user'], source: 'Both' },
  { name: 'Reddit', commands: ['hot', 'search', 'subreddit', 'read'], source: 'Both' },
  { name: 'Threads', commands: ['search', 'trending'], source: 'Extension' },
  { name: 'WeChat', commands: ['article', 'download', 'repurpose'], source: 'Both' },
  { name: 'Xiaohongshu', commands: ['search', 'feed', 'user', 'download', 'repurpose'], source: 'Both' },
  { name: 'Weibo', commands: ['hot', 'search'], source: 'Both' },
  { name: 'Bilibili', commands: ['hot', 'search', 'ranking', 'download'], source: 'Both' },
  { name: 'Douban', commands: ['search', 'top250', 'movie-hot', 'book-hot', 'reviews'], source: 'Extension' },
  { name: 'Zhihu', commands: ['hot', 'search'], source: 'Extension' },
  { name: 'Xueqiu', commands: ['hot', 'search', 'hot-stock', 'feed'], source: 'Extension' },
  { name: '36Kr', commands: ['news', 'hot', 'search', 'article'], source: 'Both' },
  { name: 'Jike', commands: ['feed', 'search', 'post', 'topic'], source: 'Extension' },
  { name: 'LinkedIn', commands: ['search', 'timeline'], source: 'Extension' },
  { name: 'Medium', commands: ['feed', 'search', 'user'], source: 'Extension' },
  { name: 'Google', commands: ['news', 'search', 'trends'], source: 'Extension' },
  { name: 'Yahoo Finance', commands: ['quote'], source: 'Extension' },
  { name: 'Facebook', commands: ['feed', 'search'], source: 'Extension' },
  { name: 'Hacker News', commands: ['top', 'new', 'best', 'ask', 'show', 'search'], source: 'CLI' },
  { name: 'GitHub', commands: ['trending', 'releases', 'search'], source: 'CLI' },
  { name: 'Product Hunt', commands: ['today', 'hot', 'posts'], source: 'CLI' },
  { name: 'Dev.to', commands: ['top', 'tag', 'user'], source: 'CLI' },
  { name: 'V2EX', commands: ['hot', 'latest', 'topic', 'node'], source: 'CLI' },
  { name: 'Hugging Face', commands: ['top', 'papers'], source: 'CLI' },
  { name: 'BBC', commands: ['news'], source: 'CLI' },
  { name: 'Bloomberg', commands: ['markets', 'tech', 'economics', 'news'], source: 'CLI' },
  { name: 'Xiaoyuzhou', commands: ['podcast', 'episodes'], source: 'CLI' },
  { name: 'RSS Feeds', commands: ['TechCrunch', 'The Verge', 'Ars Technica', 'MIT Tech Review', 'Decrypt'], source: 'CLI' },
];

const PlatformRow: React.FC<{ p: Platform; i: number }> = ({ p, i }) => (
  <motion.tr
    initial={{ opacity: 0 }}
    whileInView={{ opacity: 1 }}
    viewport={{ once: true }}
    transition={{ duration: 0.15, delay: i * 0.015 }}
    className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]"
  >
    <td className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-space-text">{p.name}</td>
    <td className="px-4 py-2.5">
      <div className="flex flex-wrap gap-1">
        {p.commands.map((c) => (
          <code key={c} className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-space-muted">
            {c}
          </code>
        ))}
      </div>
    </td>
    <td className="hidden whitespace-nowrap px-4 py-2.5 text-center sm:table-cell">
      {p.source === 'Both' ? (
        <div className="flex justify-center gap-1">
          <span className="inline-flex items-center rounded-full bg-teal-400/10 px-2 py-0.5 text-[10px] font-medium text-teal-400">CLI</span>
          <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-space-muted">Extension</span>
        </div>
      ) : (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
          p.source === 'CLI' ? 'bg-teal-400/10 text-teal-400' : 'bg-white/[0.06] text-space-muted'
        }`}>
          {p.source}
        </span>
      )}
    </td>
  </motion.tr>
);

const MOBILE_DEFAULT = 6;

const PlatformSupport: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="relative py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <SectionHeader title="Platform Support" description={`${platforms.length} platforms. One tool.`} />
        </motion.div>

        {/* Desktop: full table */}
        <div className="hidden overflow-x-auto rounded-xl border border-white/[0.08] md:block">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="whitespace-nowrap px-4 py-2.5 text-xs font-medium text-space-dim">Platform</th>
                <th className="px-4 py-2.5 text-xs font-medium text-space-dim">Commands</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-center text-xs font-medium text-space-dim">Source</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p, i) => <PlatformRow key={p.name} p={p} i={i} />)}
            </tbody>
          </table>
        </div>

        {/* Mobile: collapsible list */}
        <div className="space-y-2 md:hidden">
          {(expanded ? platforms : platforms.slice(0, MOBILE_DEFAULT)).map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.15, delay: i * 0.02 }}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-space-text">{p.name}</span>
                {p.source === 'Both' ? (
                  <div className="flex gap-1">
                    <span className="rounded-full bg-teal-400/10 px-1.5 py-0.5 text-[9px] font-medium text-teal-400">CLI</span>
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-space-muted">Ext</span>
                  </div>
                ) : (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                    p.source === 'CLI' ? 'bg-teal-400/10 text-teal-400' : 'bg-white/[0.06] text-space-muted'
                  }`}>{p.source}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.commands.map((c) => (
                  <code key={c} className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-space-muted">{c}</code>
                ))}
              </div>
            </motion.div>
          ))}
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] py-3 text-xs font-medium text-space-muted transition-colors hover:bg-white/[0.02]"
            >
              Show all {platforms.length} platforms
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <p className="mt-4 text-xs text-space-dim">
          Video download supports 1000+ sites via yt-dlp. Browser adapters require the BNBot Extension.
        </p>
      </div>
    </section>
  );
};

export default PlatformSupport;
