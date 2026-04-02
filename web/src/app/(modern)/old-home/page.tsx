'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { PenTool } from 'lucide-react';
import {
  YouTubeIcon,
  TikTokIcon,
  WeChatIcon,
  TwitterBirdIcon,
  BitcoinIcon,
  BananaIcon,
  GeminiIcon,
  BookmarkColorIcon,
  CalendarColorIcon,
  ReplyColorIcon,
  TargetColorIcon,
  ShieldColorIcon,
  QuoteColorIcon,
  SearchColorIcon,
  ThreadMergeIcon,
  BellColorIcon,
  CreditCardColorIcon,
  EditColorIcon,
  AutoReplyIcon,
  CustomTaskIcon,
  FollowDigestIcon,
  AutoNotificationsIcon,
  XAnalysisIcon,
  XBalanceIcon,
  XiaohongshuIcon,
} from '@/components/icons/feature-icons';
import { FeatureTabItem } from '@/components/homepage/FeatureTabs';
import {
  Navbar,
  Hero,
  Stats,
  FeatureTabs,
  Features,
  AgentsCarousel,
  BrandLogos,
  Pricing,
  Testimonials,
  Footer,
  Agent,
} from '@/components/homepage';
import ClassicLayout from '@/layouts/classic/layout';
import { useHomeTranslations } from '@/context/locale-context';

export default function HomePage() {
  const { t } = useHomeTranslations('home');

  // Agent data with translations
  const agents: Agent[] = [
    {
      id: 'crypto-analyst',
      name: t('agents.xTrend.name'),
      description: t('agents.xTrend.description'),
      tags: [
        t('agents.xTrend.tags.0'),
        t('agents.xTrend.tags.1'),
        t('agents.xTrend.tags.2'),
      ],
      iconUrl: 'https://img.icons8.com/3d-fluency/94/bitcoin.png',
      statusColor: 'green',
      color: 'gold',
      gradient: 'from-gold-400 to-yellow-500',
      avatar: '₿',
      link: '/chat',
    },
    {
      id: 'x-agent',
      name: t('agents.xAgent.name'),
      description: t('agents.xAgent.description'),
      tags: [
        t('agents.xAgent.tags.0'),
        t('agents.xAgent.tags.1'),
        t('agents.xAgent.tags.2'),
      ],
      iconUrl:
        'https://upload.wikimedia.org/wikipedia/commons/5/5a/X_icon_2.svg',
      statusColor: 'yellow',
      color: 'black',
      gradient: 'from-slate-700 to-slate-900',
      avatar: '𝕏',
      link: '/x-agent',
    },
    {
      id: 'boost-agent',
      name: t('agents.xBoost.name'),
      description: t('agents.xBoost.description'),
      tags: [
        t('agents.xBoost.tags.0'),
        t('agents.xBoost.tags.1'),
        t('agents.xBoost.tags.2'),
      ],
      iconUrl: 'https://img.icons8.com/3d-fluency/94/rocket.png',
      statusColor: 'yellow',
      color: 'gold',
      gradient: 'from-yellow-400 to-gold-600',
      avatar: '🚀',
    },
  ];

  // Video Placeholders
  const VIDEOS = {
    bunny:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    elephants:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    blazes:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    escapes:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    fun: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    joyrides:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    meltdowns:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    sintel:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    subaru:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
    tears:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    vw: 'https://storage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4',
    bullrun:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
    cosmos:
      'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
    oceans: 'https://vjs.zencdn.net/v/oceans.mp4',
    android:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/GoogleIO-2014-Android-TV.mp4',
    casting:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/GoogleIO-2014-Casting-To-The-Future.mp4',
    chrome:
      'https://storage.googleapis.com/gtv-videos-bucket/sample/MakingOfChrome.mp4',
    car: 'https://storage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4',
    jellyfish:
      'https://test-videos.co.uk/vids/jellyfish/mp4/h264/1080/Jellyfish_1080_10s_1MB.mp4',
    blue: 'https://media.w3.org/2010/05/video/movie_300.webm',
    cyberpunk:
      'https://static.videezy.com/system/resources/previews/000/044/565/original/P1011397.mp4',
  };

  // Section 1: Content Creation (6 features)
  const section1Features: FeatureTabItem[] = React.useMemo(
    () => [
      {
        id: 'createTweets',
        title: t('features.items.createTweets.title'),
        description: t('features.items.createTweets.description'),
        longDescription:
          'Generate viral tweets instantly using our advanced AI models trained on millions of high-engagement posts.',
        icon: PenTool,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/CreateArticle-1080p.mp4',
      },
      {
        id: 'imageCreation',
        title: t('features.items.imageCreation.title'),
        description: t('features.items.imageCreation.description'),
        longDescription:
          'Create stunning visuals and memes that capture attention and drive engagement on your timeline.',
        icon: BananaIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/imageCreator-1080p.mp4',
      },
      {
        id: 'youtubeToX',
        title: t('features.items.youtubeToX.title'),
        description: t('features.items.youtubeToX.description'),
        longDescription:
          'Repurpose long-form YouTube videos into engaging Twitter threads automatically.',
        icon: YouTubeIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/youtubeRepurpose-1080p.mp4',
      },
      {
        id: 'tiktokToX',
        title: t('features.items.tiktokToX.title'),
        description: t('features.items.tiktokToX.description'),
        longDescription:
          'Transform TikTok videos into viral Twitter content with AI-powered repurposing.',
        icon: TikTokIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/tiktokRepurpose-1080p.mp4',
      },
      {
        id: 'wechatArticle',
        title: t('features.items.wechatArticle.title'),
        description: t('features.items.wechatArticle.description'),
        longDescription:
          'Repurpose WeChat Official Account articles into engaging Twitter threads automatically.',
        icon: WeChatIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/wechatRepurpose-1080p.mp4',
      },
      {
        id: 'xiaohongshuToX',
        title: t('features.items.xiaohongshuToX.title'),
        description: t('features.items.xiaohongshuToX.description'),
        longDescription:
          'Transform Xiaohongshu posts into viral Twitter content with AI-powered repurposing.',
        icon: XiaohongshuIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/xiaohongshuRepost-1080p.mp4',
      },
      {
        id: 'tweetRepurpose',
        title: t('features.items.tweetRepurpose.title'),
        description: t('features.items.tweetRepurpose.description'),
        longDescription:
          'Give new life to your best performing content. Remix and repost with a fresh perspective.',
        icon: TwitterBirdIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/aiRewrite-1080p.mp4',
      },
    ],
    [
      t,
      VIDEOS.cosmos,
      VIDEOS.elephants,
      VIDEOS.blazes,
      VIDEOS.android,
    ],
  );

  // Section 2: Trend Insights (5 features)
  const section2Features: FeatureTabItem[] = React.useMemo(
    () => [
      {
        id: 'web3Trends',
        title: t('features.items.web3Trends.title'),
        description: t('features.items.web3Trends.description'),
        longDescription:
          'Stay ahead of the curve with real-time insights into the hottest Web3 discussions.',
        icon: BitcoinIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/Web3Trends-1080p.mp4',
      },
      {
        id: 'aiTrends',
        title: t('features.items.aiTrends.title'),
        description: t('features.items.aiTrends.description'),
        longDescription:
          'Track the latest AI developments and discussions across the platform.',
        icon: GeminiIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/aiTrends-1080p.mp4',
      },
      {
        id: 'smartSearch',
        title: t('features.items.smartSearch.title'),
        description: t('features.items.smartSearch.description'),
        longDescription:
          'Execute complex search queries on X to find exactly the signal you are looking for.',
        icon: SearchColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/smartSearch-1080p.mp4',
      },
      {
        id: 'replyExposure',
        title: t('features.items.replyExposure.title'),
        description: t('features.items.replyExposure.description'),
        longDescription:
          'Identify the best tweets to reply to for maximum visibility and engagement.',
        icon: TargetColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/exposurePredict-1080p.mp4',
        title: t('features.items.threadSummary.title'),
        description: t('features.items.threadSummary.description'),
        longDescription:
          'Digest long threads instantly. Get the key takeaways without reading the wall of text.',
        icon: ThreadMergeIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/mergeThread-1080p.mp4',
      },
    ],
    [
      t,
      VIDEOS.bullrun,
      VIDEOS.sintel,
      VIDEOS.joyrides,
    ],
  );

  // Section 3: Productivity Tools (5 features)
  const section3Features: FeatureTabItem[] = React.useMemo(
    () => [
      {
        id: 'articleEditor',
        title: t('features.items.articleEditor.title'),
        description: t('features.items.articleEditor.description'),
        longDescription:
          'Write professional long-form articles with our advanced editor and formatting tools.',
        icon: EditColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/longFormEditor-1080p.mp4',
      },
      {
        id: 'adRemoval',
        title: t('features.items.adRemoval.title'),
        description: t('features.items.adRemoval.description'),
        longDescription:
          'Remove distracting ads from your X timeline for a cleaner, more focused experience.',
        icon: ShieldColorIcon,
        color: 'text-[#536471]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/adRemove-1080p.mp4',
      },
      {
        id: 'bookmarkSummary',
        title: t('features.items.bookmarkSummary.title'),
        description: t('features.items.bookmarkSummary.description'),
        longDescription:
          'Turn your chaotic bookmarks into a structured knowledge base with AI summarization.',
        icon: BookmarkColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/bookmarkSummary-1080p.mp4',
      },
      {
        id: 'aiReply',
        title: t('features.items.aiReply.title'),
        description: t('features.items.aiReply.description'),
        longDescription:
          'Generate intelligent, context-aware replies with one click to boost your engagement.',
        icon: ReplyColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/aiReply-1080p.mp4',
      },
      {
        id: 'aiQuote',
        title: t('features.items.aiQuote.title'),
        description: t('features.items.aiQuote.description'),
        longDescription:
          'Create engaging quote tweets with AI-powered insights and commentary.',
        icon: QuoteColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/aiQuote-1080p.mp4',
      },
      {
        id: 'scheduledPosts',
        title: t('features.items.scheduledPosts.title'),
        description: t('features.items.scheduledPosts.description'),
        longDescription:
          'Plan your content calendar in advance and post at the optimal times for engagement.',
        icon: CalendarColorIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/scheduledPost-1080p.mp4',
      },
    ],
    [t, VIDEOS.meltdowns, VIDEOS.vw, VIDEOS.casting, VIDEOS.car],
  );

  // Section 4: Agent Automation (4 features)
  const section4Features: FeatureTabItem[] = React.useMemo(
    () => [
      {
        id: 'agentAutoReply',
        title: t('features.items.agentAutoReply.title'),
        description: t('features.items.agentAutoReply.description'),
        longDescription:
          'Set up automated agent replies to maintain presence while you sleep.',
        icon: AutoReplyIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/autoPilot-1080p.mp4',
      },
      {
        id: 'agentCustomTasks',
        title: t('features.items.agentCustomTasks.title'),
        description: t('features.items.agentCustomTasks.description'),
        longDescription:
          'Configure custom workflows and tasks for your agents to execute.',
        icon: CustomTaskIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: VIDEOS.escapes,
      },
      {
        id: 'followDigest',
        title: t('features.items.followDigest.title'),
        description: t('features.items.followDigest.description'),
        longDescription:
          'Get daily digest of your follows activities and updates.',
        icon: FollowDigestIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: VIDEOS.fun,
      },
      {
        id: 'autoNotifications',
        title: t('features.items.autoNotifications.title'),
        description: t('features.items.autoNotifications.description'),
        longDescription:
          'Automatically process and handle your X notifications.',
        icon: AutoNotificationsIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: VIDEOS.joyrides,
      },
      {
        id: 'xAnalysis',
        title: t('features.items.xAnalysis.title'),
        description: t('features.items.xAnalysis.description'),
        longDescription:
          'Deep analytics and insights for your X account performance.',
        icon: XAnalysisIcon,
        color: 'text-[#0f1419]',
        bgColor: 'bg-slate-50',
        videoSrc: 'https://cdn.bnbot.ai/bnbot-demo-videos/XAnalysis-1080p.mp4',
      },
    ],
    [t, VIDEOS.tears, VIDEOS.bunny, VIDEOS.fun, VIDEOS.escapes],
  );

  return (
    <ClassicLayout contentClassName="!p-0">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen bg-white font-sans text-slate-900 selection:bg-gold-400/30"
      >
        <Navbar />

        <main>
          <Hero />

          {/* Agents Grid Section */}
          <section id="agents" className="relative overflow-hidden pb-24 pt-10">
            {/* Background Gradients */}
            <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-50/80 via-white to-white" />

            {/* Decorative Blobs */}
            <div className="animate-blob pointer-events-none absolute left-1/4 top-0 h-96 w-96 rounded-full bg-gold-100/40 opacity-70 mix-blend-multiply blur-[100px] filter" />
            <div className="animate-blob animation-delay-2000 pointer-events-none absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-blue-50/40 opacity-70 mix-blend-multiply blur-[100px] filter" />

            <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col items-center">
                <div className="mb-8 text-center select-none">
                  <p className="mb-2 text-xs font-light tracking-wide text-slate-500 md:text-sm">
                    {t('agentsSection.versionInfo')}
                  </p>
                  <p className="mx-auto max-w-2xl text-xs font-light text-slate-500 opacity-80 md:text-sm">
                    {t('agentsSection.newFeatures')}
                  </p>
                </div>
                {/* TODO: Temporarily hidden - uncomment when banner images are ready */}
                {/* <AgentsCarousel agents={agents} /> */}
                <BrandLogos />
              </div>
            </div>
          </section>

          {/* Stats Section */}
          <Stats />

          {/* Section 1: Creation & Trends (Left) - 6 items */}
          <div id="features">
            <FeatureTabs
              sectionTitle={
                <>
                  {t('features.section1.titlePrefix')}{' '}
                  <span className="bg-gradient-to-r from-gold-500 to-amber-600 bg-clip-text text-transparent">
                    {t('features.section1.titleHighlight')}
                  </span>
                </>
              }
              sectionDescription={t('features.section1.description')}
              align="left"
              tabs={section1Features}
            />
          </div>

          {/* Section 2: Management (Right) - 6 items */}
          <FeatureTabs
            sectionTitle={
              <>
                {t('features.section2.titlePrefix')}{' '}
                <span className="bg-gradient-to-r from-gold-500 to-amber-600 bg-clip-text text-transparent">
                  {t('features.section2.titleHighlight')}
                </span>
              </>
            }
            sectionDescription={t('features.section2.description')}
            align="right"
            tabs={section2Features}
          />

          {/* Section 3: Productivity Tools (Left) - 4 items */}
          <FeatureTabs
            sectionTitle={
              <>
                {t('features.section3.titlePrefix')}{' '}
                <span className="bg-gradient-to-r from-yellow-500 to-amber-600 bg-clip-text text-transparent">
                  {t('features.section3.titleHighlight')}
                </span>
              </>
            }
            sectionDescription={t('features.section3.description')}
            align="left"
            tabs={section3Features}
          />

          {/* Section 4: Agent Automation (Right) - 6 items */}
          <FeatureTabs
            sectionTitle={
              <>
                {t('features.section4.titlePrefix')}{' '}
                <span className="bg-gradient-to-r from-gold-500 to-yellow-500 bg-clip-text text-transparent">
                  {t('features.section4.titleHighlight')}
                </span>
              </>
            }
            sectionDescription={t('features.section4.description')}
            align="right"
            tabs={section4Features}
          />

          {/* Features Grid Section */}
          {/* <Features /> */}

          {/* Pricing Section */}
          <Pricing />

          {/* Testimonials Section */}
          <Testimonials />
        </main>

        <Footer />
      </motion.div>
    </ClassicLayout>
  );
}
