'use client';
import { FC, ReactNode, useState, useEffect, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';

interface FamilyButtonProps {
  children: (onClose: () => void) => React.ReactNode;
}

const FamilyButton: React.FC<FamilyButtonProps> = ({ children }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = 'hidden';
      // Enable animation when opening
      setShouldAnimate(true);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isExpanded]);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const handleClose = () => {
    // Disable animation before closing for instant hide
    setShouldAnimate(false);
    setIsExpanded(false);
  };

  return (
    <>
      {/* Backdrop overlay */}
      {isExpanded && (
        <div
          className={cn(
            "fixed inset-0 z-30 bg-black/30",
            shouldAnimate && "animate-fade-in"
          )}
          onClick={handleClose}
        />
      )}

      {/* Expanded panel */}
      {isExpanded && (
        <div
          className={cn(
            "fixed bottom-4 left-3 right-3 z-40 overflow-hidden rounded-[24px] border border-gray-200/80 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900",
            shouldAnimate && "animate-slide-up"
          )}
          style={{ height: 'calc(100dvh - 80px)', maxHeight: '600px' }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute right-3 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
              aria-label="Close"
            >
              <XIcon className="h-4 w-4" />
            </button>

            {children(handleClose)}
        </div>
      )}

      {/* Collapsed button */}
      {!isExpanded && (
        <motion.div
          className="group cursor-pointer transition-colors duration-200"
          onClick={toggleExpand}
          whileTap={{ scale: 0.95 }}
        >
          <div className="relative flex h-[56px] w-[56px] items-center justify-center">
            {/* Animated glowing ring - slower animation */}
            <div className="absolute inset-0 animate-pulse-slow rounded-full bg-gradient-to-r from-[#f0b90b] to-[#e6af0a] opacity-40 blur-md"></div>
            <div className="absolute inset-0 animate-ping-slow rounded-full bg-gradient-to-r from-[#f0b90b] to-[#e6af0a] opacity-20"></div>

            {/* Thin golden ring around the logo */}
            <div className="relative z-10 rounded-full border-4 border-[#f0b90b]/50">
              <Image
                src={bnbotAI}
                alt="BNBOT AI"
                width={40}
                height={40}
                className="rounded-full"
              />
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
};

export { FamilyButton };
