'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import useMeasure from 'react-use-measure';
import Image from 'next/image';
import { FamilyButton } from '@/components/ui/family-button';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import { TextAnimate } from '@/components/ui/text-animate';
import { cn } from '@/lib/utils';

interface BoostEngagementButtonProps {
  quoteUrl?: string;
  replyUrl?: string;
  className?: string;
  onQuote?: () => void;
  onReply?: () => void;
}

type TabKey = 'quote' | 'reply';

const tabs: Array<{ id: TabKey; label: string }> = [
  { id: 'quote', label: 'AI Quote' },
  { id: 'reply', label: 'AI Reply' },
];

export default function BoostEngagementButton({
  quoteUrl,
  replyUrl,
  className,
  onQuote,
  onReply,
}: BoostEngagementButtonProps) {
  return (
    <div className={className}>
      <FamilyButton>
        {() => (
          <BoostEngagementContent
            quoteUrl={quoteUrl}
            replyUrl={replyUrl}
            onQuote={onQuote}
            onReply={onReply}
          />
        )}
      </FamilyButton>
    </div>
  );
}

function BoostEngagementContent({
  quoteUrl,
  replyUrl,
  onQuote,
  onReply,
}: {
  quoteUrl?: string;
  replyUrl?: string;
  onQuote?: () => void;
  onReply?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('quote');
  const [direction, setDirection] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [ref, bounds] = useMeasure();

  const { heading, ctaHandler } = useMemo(() => {
    if (activeTab === 'quote') {
      return {
        heading: 'Generate Content...',
        ctaHandler: quoteUrl
          ? () => {
              onQuote?.();
              if (typeof window !== 'undefined') {
                window.open(quoteUrl, '_blank', 'noopener,noreferrer');
              }
            }
          : undefined,
      };
    }

    return {
      heading: 'Generate Reply...',
      ctaHandler: replyUrl
        ? () => {
            onReply?.();
            if (typeof window !== 'undefined') {
              window.open(replyUrl, '_blank', 'noopener,noreferrer');
            }
          }
        : undefined,
    };
  }, [activeTab, onQuote, onReply, quoteUrl, replyUrl]);

  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab || isAnimating) return;
    setDirection(tab === 'reply' ? 1 : -1);
    setActiveTab(tab);
  };

  const variants = {
    initial: (dir: number) => ({
      x: 220 * dir,
      opacity: 0,
      filter: 'blur(4px)',
    }),
    active: {
      x: 0,
      opacity: 1,
      filter: 'blur(0px)',
    },
    exit: (dir: number) => ({
      x: -220 * dir,
      opacity: 0,
      filter: 'blur(4px)',
    }),
  };

  return (
    <div className="flex flex-col items-center pt-4">
      <div className="shadow-inner-shadow flex cursor-pointer space-x-1 rounded-lg border border-none bg-gray-200 px-[4px] py-[3px]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              'relative rounded-md px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b90b]/70 sm:text-sm',
              activeTab === tab.id
                ? 'text-gray-800'
                : 'text-gray-500 hover:text-gray-600',
            )}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {activeTab === tab.id && (
              <motion.span
                layoutId="boost-engagement-pill"
                className="shadow-inner-shadow absolute inset-0 z-10 bg-white"
                style={{ borderRadius: 6 }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              />
            )}
            <span className="relative z-20">{tab.label}</span>
          </button>
        ))}
      </div>

      <MotionConfig transition={{ duration: 0.35, type: 'spring', bounce: 0.2 }}>
        <motion.div
          className="relative mx-auto my-3 w-full overflow-hidden"
          initial={false}
          animate={{ height: bounds.height }}
        >
          <div ref={ref} className="p-2 md:p-6">
            <AnimatePresence
              custom={direction}
              mode="popLayout"
              onExitComplete={() => setIsAnimating(false)}
            >
              <motion.div
                key={activeTab}
                variants={variants}
                custom={direction}
                initial="initial"
                animate="active"
                exit="exit"
                onAnimationStart={() => setIsAnimating(true)}
                onAnimationComplete={() => setIsAnimating(false)}
                className={cn(
                  'space-y-4 px-3 pb-4 pt-2 text-center',
                  ctaHandler
                    ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b90b]/60'
                    : '',
                )}
                role={ctaHandler ? 'button' : undefined}
                tabIndex={ctaHandler ? 0 : undefined}
                onClick={() => ctaHandler?.()}
                onKeyDown={(event) => {
                  if (!ctaHandler) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    ctaHandler();
                  }
                }}
              >
                <div className="relative mx-auto h-14 w-14">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#f0b90b]/40 to-[#e6af0a]/30 blur-md animate-pulse-slow" />
                  <div className="absolute inset-0 rounded-full border border-[#f0b90b]/50" />
                  <Image
                    src={bnbotAI}
                    alt="BNBOT AI"
                    fill
                    className="rounded-full object-cover"
                  />
                </div>
                <div className="space-y-1">
                  <TextAnimate
                    className="text-sm font-medium text-gray-800"
                    animation="slideUp"
                    by="line"
                  >
                    {heading}
                  </TextAnimate>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </MotionConfig>
    </div>
  );
}
