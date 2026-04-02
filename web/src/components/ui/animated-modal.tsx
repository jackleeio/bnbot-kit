'use client';
import cn from '@/utils/cn';
import { AnimatePresence, motion } from 'framer-motion';
import React, {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Tweet } from '@/types';
import TweetDetail from '@/components/chat/tweetDetail';
import BoostModal from '@/components/boost/boost-modal';
import { ArrowUpRightIcon } from '@heroicons/react/24/solid';
import { useRouter } from 'next/navigation';
import type { BoostPublic } from '@/lib/boost-api';

interface RetweetUser {
  description: string;
  followers_count: number;
  friends_count: number;
  media_count: number;
  name: string;
  profile_image: string;
  screen_name: string;
  statuses_count: number;
  user_id: string;
}

interface XAsset {
  id: string;
  tweetId: string;
  irysTxId: string;
  name: string;
  symbol: string;
  author: string;
  tokenAddress: string;
  maxSupply: string;
  totalSupply: string;
  owner: string;
  createdAt: string;
  lastTradedAt: string | null;
  lastTradedPrice: string | null;
  uri: string;
  deployer: string;
  deployedAt: string;
  holderCount: string;
}

interface TrendTweet {
  id_str: string;
  created_at: string;
  text: string;
  reply_count: number;
  retweet_count: number;
  like_count: number;
  quote_count: number;
  view_count: string;
  is_retweet: boolean;
  retweeted_status_id: string | null;
  is_quote: boolean;
  quoted_status_id: string | null;
  author: {
    username: string;
    twitter_id: string;
    name: string;
    avatar: string;
    description: string;
  };
  media: {
    type: string;
    url: string;
    thumbnail?: string;
  }[] | null;
  quoted_tweet?: {
    id_str: string;
    text: string;
    created_at: string;
    user: {
      name: string;
      username: string;
      avatar: string;
    };
  } | null;
}

interface ModalContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  showModal: (
    content: XAsset | null,
    tweet: TrendTweet | Tweet | null,
    type: 'asset' | 'tweet' | 'boost',
    tweetLink?: string
  ) => void;
  showBoostModal: (boost: BoostPublic) => void;
  modalType: 'asset' | 'tweet' | 'boost';
  modalContent: XAsset | null;
  modalBoost: BoostPublic | null;
  modalTweet?: TrendTweet | Tweet | null;
  tweetLink?: string;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [modalType, setModalType] = useState<'asset' | 'tweet' | 'boost'>('asset');
  const [modalContent, setModalContent] = useState<XAsset | null>(null);
  const [modalBoost, setModalBoost] = useState<BoostPublic | null>(null);
  const [modalTweet, setModalTweet] = useState<TrendTweet | Tweet | null>(null);
  const [tweetLink, setTweetLink] = useState<string>('');

  const showModal = (
    content: XAsset | null,
    tweet: TrendTweet | Tweet | null,
    type: 'asset' | 'tweet' | 'boost',
    tweetLink?: string
  ) => {
    setModalContent(content);
    setModalTweet(tweet);
    setModalType(type);
    setTweetLink(tweetLink ?? '');
    setOpen(true);
  };

  const showBoostModal = (boost: BoostPublic) => {
    setModalBoost(boost);
    setModalType('boost');
    setOpen(true);
  };

  return (
    <ModalContext.Provider value={{
      open,
      setOpen,
      showModal,
      showBoostModal,
      modalType,
      modalContent,
      modalBoost,
      modalTweet,
      tweetLink
    }}>
      {open && (modalType === 'boost' ? (
        <BoostModal
          boost={modalBoost}
        />
      ) : (
        <TweetDetail
          tweet={modalTweet as TrendTweet}
        />
      ))}
      {children}
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};

export function Modal({ children }: { children: ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>;
}

export const ModalTrigger = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const { setOpen } = useModal();
  return (
    <button
      className={cn(
        'relative overflow-hidden rounded-md px-4 py-2 text-center text-black dark:text-white',
        className,
      )}
      onClick={() => setOpen(true)}
    >
      {children}
    </button>
  );
};

export const ModalBody = ({
  children,
  className,
  assetId,
}: {
  children: ReactNode;
  className?: string;
  assetId?: string;
}) => {
  const { open, modalType } = useModal();
  const modalRef = useRef(null);
  const { setOpen } = useModal();
  const router = useRouter();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      
      // Add keyboard event listener for ESC key
      const handleEscKey = (event: KeyboardEvent) => {
        // Only close modal if the event wasn't stopped by a child component
        if (event.key === 'Escape' && !event.defaultPrevented) {
          setOpen(false);
        }
      };
      
      document.addEventListener('keydown', handleEscKey);
      
      return () => {
        document.body.style.overflow = 'auto';
        document.removeEventListener('keydown', handleEscKey);
      };
    }
  }, [open, setOpen]);

  const handleClose = () => {
    setOpen(false);
    
    // 防止点击穿透：禁用页面所有点击事件一段时间
    document.body.style.pointerEvents = 'none';
    
    // 同时添加一个遮罩层来完全阻止点击事件
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 9999;
      pointer-events: auto;
      background: transparent;
    `;
    overlay.id = 'modal-close-overlay';
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      document.body.style.pointerEvents = 'auto';
      const existingOverlay = document.getElementById('modal-close-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }
    }, 500); // 增加到500ms确保完全阻止点击穿透
  };

  useOutsideClick(modalRef, handleClose);

  return (
    <AnimatePresence mode="wait">
      {open && (
        <motion.div
          initial={{ opacity: modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? 1 : 0 }}
          animate={{
            opacity: 1,
            backdropFilter: 'blur(10px)',
          }}
          exit={{
            opacity: modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? 1 : 0,
            backdropFilter: 'blur(0px)',
          }}
          transition={{ 
            duration: modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? 0 : 0
          }}
          className="fixed inset-0 z-50 flex h-full w-full items-center justify-center [perspective:800px] [transform-style:preserve-3d] px-2"
        >
          <Overlay 
            modalType={modalType} 
            onClose={handleClose} 
          />

          <motion.div
            ref={modalRef}
            className={cn(
              'relative z-50 flex max-h-[75vh] md:max-h-[85vh] h-[85vh] flex-1 flex-col overflow-hidden border border-transparent bg-white dark:border-neutral-800 dark:bg-neutral-950 md:rounded-2xl !rounded-2xl',
              modalType === 'tweet' ? 'md:max-w-[80%] lg:max-w-[1000px]' : modalType === 'boost' ? 'md:max-w-[55%]' : 'md:max-w-[38%]',
              className,
            )
}
            initial={ modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? {
              opacity: 1,
              scale: 1,
              rotateX: 0,
              y: 0,
            } : {
              opacity: 0,
              scale: 0.5,
              rotateX: 40,
              y: 40,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              rotateX: 0,
              y: 0,
            }}
            exit={ modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? {
              opacity: 1,
              scale: 1,
              rotateX: 0,
            } : {
              opacity: 0,
              scale: 0.8,
              rotateX: 10,
            }}
            transition={{
              duration:  modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? 0 : 0.2,
              type:  modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? 'tween' : 'spring',
              stiffness: 260,
              damping: 15,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {modalType !== 'tweet' && (
              <ModalAction 
                onClose={handleClose} 
                modalType={modalType} 
                assetId={assetId}
              />
            )}
            <div className="flex-1 overflow-y-auto hide-scrollbar">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const ModalContent = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn('flex flex-1 flex-col p-3', className)}>
      {children}
    </div>
  );
};

export const ModalFooter = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        'flex justify-end bg-gray-100 p-4 dark:bg-neutral-900',
        className,
      )}
    >
      {children}
    </div>
  );
};

const Overlay = ({ 
  className, 
  modalType,
  isClosing,
  onClose 
}: { 
  className?: string; 
  modalType?: 'asset' | 'tweet' | 'boost';
  isClosing?: boolean;
  onClose: () => void;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        backdropFilter: 'blur(10px)',
      }}
      exit={{
        opacity: 0,
        backdropFilter: 'blur(0px)',
        transition: {
          duration: modalType === 'asset' || modalType === 'tweet' || modalType === 'boost' ? 0 : 0.2
        }
      }}
      transition={{ 
        duration: 0.2
      }}
      className={`fixed inset-0 z-50 h-full w-full bg-black bg-opacity-50 ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // 立即阻止任何后续的点击事件
        const stopClicks = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        };
        
        document.addEventListener('click', stopClicks, { capture: true, once: true });
        document.addEventListener('mousedown', stopClicks, { capture: true, once: true });
        document.addEventListener('mouseup', stopClicks, { capture: true, once: true });
        
        // 延迟执行关闭操作
        setTimeout(() => {
          onClose();
        }, 50);
        
        return false;
      }}
    ></motion.div>
  );
};

const ModalAction = ({ 
  onClose, 
  modalType, 
  assetId 
}: { 
  onClose: () => void;
  modalType?: 'asset' | 'tweet' | 'boost';
  assetId?: string;
}) => {
  const router = useRouter();

  if (modalType === 'boost') {
    // 不要显示任何图标
    return null;
  } else if (modalType === 'asset') {
    return (
      <button
        onClick={() => {
          onClose();
          router.push(`/asset/detail?id=${assetId}`);
        }}
        className="group -mr-1 -mt-1 absolute right-4 top-4"
      >
        <ArrowUpRightIcon 
          className="h-5 w-5 text-gray-600 transition duration-200 group-hover:scale-110 group-hover:text-black" 
        />
      </button>
    );
  }

  return (
    <button
      onClick={onClose}
      className="group absolute right-4 top-4"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 text-black transition duration-200 group-hover:rotate-3 group-hover:scale-125 dark:text-white"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M18 6l-12 12" />
        <path d="M6 6l12 12" />
      </svg>
    </button>
  );
};

// Hook to detect clicks outside of a component.
// Add it in a separate file, I've added here for simplicity
export const useOutsideClick = (
  ref: React.RefObject<HTMLDivElement>,
  callback: Function,
) => {
  useEffect(() => {
    const listener = (event: any) => {
      // DO NOTHING if the element being clicked is the target element or their children
      if (!ref.current || ref.current.contains(event.target)) {
        return;
      }
      callback(event);
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, callback]);
};
