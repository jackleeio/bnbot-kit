'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Globe, Layers, Video, Palette, Search, Eye,
  PenTool, Image as ImageIcon, Youtube, Music2, MessageSquare, BookOpen, Twitter, GitCompare,
  FileEdit, ShieldOff, Bookmark, MessageCircle, Quote, Calendar, List,
  Bot, Star, Rss, Bell, BarChart3, Users,
} from 'lucide-react';
import { useHomeTranslations } from '@/context/locale-context';

interface Feature { icon: React.FC<{ className?: string }>; key: string }
interface Category { sectionKey: string; tag: string; features: Feature[] }

const categories: Category[] = [
  {
    sectionKey: 'section1',
    tag: 'CLI',
    features: [
      { icon: Globe, key: 'platformScraping' },
      { icon: Layers, key: 'convergenceDetection' },
      { icon: Video, key: 'videoDiscovery' },
      { icon: Palette, key: 'styleLearning' },
      { icon: Search, key: 'smartSearch' },
      { icon: Eye, key: 'kolMonitoring' },
    ],
  },
  {
    sectionKey: 'section2',
    tag: 'CLI + Extension',
    features: [
      { icon: PenTool, key: 'createTweets' },
      { icon: ImageIcon, key: 'imageCreation' },
      { icon: Youtube, key: 'youtubeToX' },
      { icon: Music2, key: 'tiktokToX' },
      { icon: MessageSquare, key: 'wechatArticle' },
      { icon: BookOpen, key: 'xiaohongshuToX' },
      { icon: Twitter, key: 'tweetRepurpose' },
      { icon: GitCompare, key: 'productComparison' },
    ],
  },
  {
    sectionKey: 'section3',
    tag: 'Extension',
    features: [
      { icon: FileEdit, key: 'articleEditor' },
      { icon: ShieldOff, key: 'adRemoval' },
      { icon: Bookmark, key: 'bookmarkSummary' },
      { icon: MessageCircle, key: 'aiReply' },
      { icon: Quote, key: 'aiQuote' },
      { icon: Calendar, key: 'scheduledPosts' },
      { icon: List, key: 'threadSummary' },
    ],
  },
  {
    sectionKey: 'section4',
    tag: 'Extension',
    features: [
      { icon: Bot, key: 'agentAutoReply' },
      { icon: Star, key: 'agentCustomTasks' },
      { icon: Rss, key: 'followDigest' },
      { icon: Bell, key: 'autoNotifications' },
      { icon: BarChart3, key: 'xAnalysis' },
      { icon: Users, key: 'multiAccount' },
    ],
  },
];

const FeatureList: React.FC = () => {
  const { t } = useHomeTranslations('home.features');

  return (
    <section className="relative py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          {categories.map((cat, ci) => (
            <motion.div
              key={cat.sectionKey}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: ci * 0.1 }}
            >
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-1 w-10 rounded-full bg-gradient-to-r from-coral-500 to-coral-400" />
                  <span className="rounded-full border border-white/[0.1] px-2.5 py-0.5 text-[10px] font-medium text-space-dim">
                    {cat.tag}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-space-text md:text-2xl">
                  {t(`${cat.sectionKey}.titlePrefix`)}{' '}
                  <span className="bg-gradient-to-r from-coral-500 to-coral-400 bg-clip-text text-transparent">
                    {t(`${cat.sectionKey}.titleHighlight`)}
                  </span>
                </h3>
                <p className="mt-2 text-sm text-space-muted">{t(`${cat.sectionKey}.description`)}</p>
              </div>

              <div className="space-y-2">
                {cat.features.map((f, fi) => {
                  const Icon = f.icon;
                  return (
                    <motion.div
                      key={f.key}
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: ci * 0.1 + fi * 0.04 }}
                      className="group flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3 transition-all duration-200 hover:border-coral-500/15 hover:bg-white/[0.04] hover:translate-x-1"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-coral-500 transition-transform duration-200 group-hover:scale-110" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-space-text">{t(`items.${f.key}.title`)}</div>
                        <div className="text-[11px] text-space-dim">{t(`items.${f.key}.description`)}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeatureList;
