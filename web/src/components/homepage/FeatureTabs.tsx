'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useHomeTranslations } from '@/context/locale-context';
import { useIntersectionObserver } from '@/hooks/use-intersection-observer';

import { LucideIcon, ChevronRight } from 'lucide-react';

// 支持 LucideIcon 或自定义 SVG 图标组件
type IconComponent = LucideIcon | React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>;

export interface FeatureTabItem {
  id: string;
  title: string;
  description: string;
  longDescription: string;
  icon: IconComponent;
  videoSrc?: string;
  thumbnail?: string;
  color: string;
  bgColor: string;
}

interface FeatureTabsProps {
  sectionTitle: React.ReactNode;
  sectionDescription: string;
  align?: 'left' | 'right';
  tabs: FeatureTabItem[];
}

// 固定高度 - 所有卡片高度相同，不做高度动画
const TAB_HEIGHT = 68;
const GAP = 12; // gap-3 = 0.75rem = 12px

const TabItem = React.memo(
  ({
    feature,
    onActivate,
    index,
  }: {
    feature: FeatureTabItem;
    onActivate: (id: string) => void;
    index: number;
  }) => {
    return (
      <div
        className="group relative"
        style={{
          height: TAB_HEIGHT + GAP,
          paddingBottom: GAP,
        }}
      >
        <div
          className="relative h-full rounded-2xl bg-white shadow-[0_0_15px_rgba(0,0,0,0.04)] group-hover:z-10 group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_20px_rgba(240,185,11,0.2)]"
          style={{
            transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out',
          }}
        >
          <button
            onClick={() => onActivate(feature.id)}
            onMouseEnter={() => onActivate(feature.id)}
            className="absolute inset-0 rounded-2xl border border-transparent bg-white px-5 text-left outline-none focus:outline-none group-hover:bg-gradient-to-r group-hover:from-amber-50 group-hover:via-amber-50/30 group-hover:to-white"
          >
            <div className="flex h-full items-center gap-4 select-none">
              <div
                className={`rounded-xl p-2 ${feature.bgColor} ${feature.color} flex-shrink-0`}
              >
                <feature.icon className="h-5 w-5 transition-all duration-300 group-hover:stroke-[2]" size={20} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <h3 className="text-base font-semibold text-[#0f1419]">
                  {feature.title}
                </h3>
                <p className="hidden text-xs font-medium leading-relaxed text-slate-500 group-hover:block">
                  {feature.description}
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  },
);
TabItem.displayName = 'TabItem';

// Video Placeholder - 视频未加载时显示的占位内容
const VideoPlaceholder = React.memo(({ feature }: { feature: FeatureTabItem }) => {
  if (feature.thumbnail) {
    return (
      <img
        src={feature.thumbnail}
        alt={feature.title}
        className="h-full w-full object-contain"
      />
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${feature.bgColor} animate-pulse`}>
        <feature.icon className={`h-10 w-10 ${feature.color}`} />
      </div>
      <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
    </div>
  );
});
VideoPlaceholder.displayName = 'VideoPlaceholder';

// Lazy Video Player - 仅在 shouldLoad && isActive 时挂载 <video>，canplaythrough 后淡入覆盖占位图
const LazyVideoPlayer = React.memo(({
  feature,
  isActive,
  shouldLoad,
}: {
  feature: FeatureTabItem;
  isActive: boolean;
  shouldLoad: boolean;
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const [ready, setReady] = React.useState(false);

  // 当不再 active 或不该加载时，重置 ready 状态
  React.useEffect(() => {
    if (!isActive || !shouldLoad) {
      setReady(false);
    }
  }, [isActive, shouldLoad]);

  // 控制播放/暂停，cleanup 时显式中断下载释放带宽
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isActive) {
      video.currentTime = 0;
      video.play().catch(() => {});
    } else {
      video.pause();
    }

    return () => {
      // 切换 tab 时立即中断下载，把带宽让给新视频
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [isActive]);

  // 视频播放结束后等待1秒再循环
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      timeoutRef.current = setTimeout(() => {
        if (video && videoRef.current) {
          video.currentTime = 0;
          video.play().catch(() => {});
        }
      }, 1000);
    };

    video.addEventListener('ended', handleEnded);
    return () => {
      video.removeEventListener('ended', handleEnded);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* 占位层 - 始终可见直到视频就绪 */}
      <div className={`absolute inset-0 transition-opacity duration-300 ${ready ? 'opacity-0' : 'opacity-100'}`}>
        <VideoPlaceholder feature={feature} />
      </div>
      {/* 视频层 - 仅在需要时挂载 */}
      {shouldLoad && isActive && feature.videoSrc && (
        <video
          ref={videoRef}
          src={feature.videoSrc}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
          autoPlay
          muted
          playsInline
          preload="auto"
          onCanPlay={(e) => {
            setReady(true);
            (e.target as HTMLVideoElement).play().catch(() => {});
          }}
        />
      )}
    </>
  );
});
LazyVideoPlayer.displayName = 'LazyVideoPlayer';

const FeatureTabs: React.FC<FeatureTabsProps> = ({
  sectionTitle,
  sectionDescription,
  align = 'left',
  tabs,
}) => {
  const { t } = useHomeTranslations('common');
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [videoTab, setVideoTab] = useState(tabs[0].id);
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());
  const addToLoaded = useCallback((id: string) => {
    setLoadedTabs((prev) => {
      if (prev.has(id)) return prev;
      return new Set(prev).add(id);
    });
  }, []);

  // 优先级 1: section 进入视口 → 立即加载默认 tab（用户正在看）
  const [sectionRef, isVisible] = useIntersectionObserver({
    threshold: 0.1,
    freezeOnceVisible: true,
  });
  React.useEffect(() => {
    if (isVisible) addToLoaded(tabs[0].id);
  }, [isVisible, tabs, addToLoaded]);

  // 优先级 2: 页面加载完 + 浏览器空闲 → 后台预加载（用户还没滚动到）
  React.useEffect(() => {
    const preload = () => {
      const schedule = typeof requestIdleCallback === 'function'
        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 3000 })
        : (cb: () => void) => setTimeout(cb, 1000);
      schedule(() => addToLoaded(tabs[0].id));
    };
    if (document.readyState === 'complete') {
      preload();
    } else {
      window.addEventListener('load', preload);
      return () => window.removeEventListener('load', preload);
    }
  }, [tabs, addToLoaded]);

  // 固定容器高度
  const containerHeight = useMemo(() => {
    const n = tabs.length;
    return n * (TAB_HEIGHT + GAP); // 每个tab包含了自己的gap
  }, [tabs.length]);

  // 使用ref存储当前activeTab，避免useCallback依赖变化
  const activeTabRef = React.useRef(activeTab);
  activeTabRef.current = activeTab;

  // Tab change handler - 不依赖activeTab，避免重新创建函数
  const handleTabChange = useCallback((id: string) => {
    if (id === activeTabRef.current) return;
    setActiveTab(id);
    setVideoTab(id);
    setLoadedTabs((prev) => new Set(prev).add(id));
  }, []);

  return (
    <section ref={sectionRef} className="relative overflow-hidden bg-white py-12 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 外层容器和下面内容区域保持一致的居中布局 */}
        <div className="flex justify-center">
          <div className={`w-full px-4 ${align === 'right' ? 'lg:px-0 lg:pr-8' : 'lg:px-0 lg:pl-8'}`} style={{ maxWidth: 'calc(360px + 900px + 80px)' }}>
            {/* Header */}
            <div
              className={`mb-8 max-w-3xl lg:mb-16 ${align === 'right' ? 'ml-auto flex flex-col items-end text-right' : 'mr-auto flex flex-col items-start text-left'}`}
            >
              <div className="mb-6 h-1.5 w-12 rounded-full bg-gradient-to-r from-amber-500 to-yellow-400"></div>
              <h2 className="font-display mb-3 text-2xl font-bold text-slate-900 lg:mb-6 md:text-4xl">
                {sectionTitle}
              </h2>
              <p className="text-sm text-slate-500 lg:text-lg">{sectionDescription}</p>
            </div>
          </div>
        </div>

        <div
          className={`flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-center lg:gap-[100px] ${align === 'right' ? 'lg:flex-row-reverse' : ''}`}
        >
          {/* Tabs Column - 桌面端竖排 */}
          <div className="hidden w-full lg:block lg:w-auto lg:min-w-[320px] lg:max-w-[360px]">
            <div className="flex flex-col" style={{ height: containerHeight }}>
              {tabs.map((feature, index) => (
                <TabItem
                  key={feature.id}
                  feature={feature}
                  onActivate={handleTabChange}
                  index={index}
                />
              ))}
            </div>

            <div className="pt-4">
              <a
                href="https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln"
                target="_blank"
                rel="noopener noreferrer"
                className="group/btn inline-flex items-center gap-2 rounded-xl bg-black px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-neutral-800"
              >
                <span>{t('startNow')}</span>
                <ChevronRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
              </a>
            </div>
          </div>

          <div className="w-full lg:w-[56%]">
            <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 p-1.5 shadow-sm lg:rounded-3xl lg:p-1.5 lg:shadow-[0_8px_30px_-10px_rgba(0,0,0,0.15)]">
              <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-inner">
                {/* Mac Browser Window Frame */}
                <div className="relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] ring-1 ring-slate-900/5">
                  {/* Browser Header */}
                  <div className="z-20 flex h-10 shrink-0 items-center gap-2 border-b border-slate-50 bg-white px-5">
                    <div className="h-3 w-3 rounded-full bg-[#FF5F56] shadow-sm"></div>
                    <div className="h-3 w-3 rounded-full bg-[#FFBD2E] shadow-sm"></div>
                    <div className="h-3 w-3 rounded-full bg-[#27C93F] shadow-sm"></div>
                  </div>

                  {/* Video Area - 按需懒加载视频 */}
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                    {tabs.map((feature) => (
                      <div
                        key={feature.id}
                        className={`absolute inset-0 transition-opacity duration-300 ${videoTab === feature.id ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'}`}
                      >
                        <LazyVideoPlayer
                          feature={feature}
                          isActive={videoTab === feature.id}
                          shouldLoad={loadedTabs.has(feature.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 移动端横向滚动 tabs - 显示在视频下方 */}
          <div className="w-full lg:hidden">
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
              {tabs.map((feature) => (
                <button
                  key={feature.id}
                  onClick={() => handleTabChange(feature.id)}
                  className={`flex flex-shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    activeTab === feature.id
                      ? 'bg-white text-slate-900 shadow-md'
                      : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                  }`}
                >
                  <feature.icon className="h-4 w-4 flex-shrink-0" size={16} style={{ width: 16, height: 16 }} />
                  <span className="whitespace-nowrap">{feature.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeatureTabs;
