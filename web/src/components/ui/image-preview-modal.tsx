'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  XMarkIcon
} from '@heroicons/react/24/outline';

interface ImagePreviewModalProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
  images?: string[]; // All images for navigation
  currentIndex?: number;
}

export default function ImagePreviewModal({ 
  isOpen, 
  imageUrl, 
  onClose,
  images = [],
  currentIndex = 0
}: ImagePreviewModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(currentIndex);
  const [navDirection, setNavDirection] = useState<1 | -1>(1);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const touchPanStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchPanOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  
  // Swipe to close refs and state
  const swipeStartYRef = useRef<number | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false);
  const swipeDistanceRef = useRef(0);

  // Preload adjacent images for faster navigation
  useEffect(() => {
    if (images.length > 0) {
      const preloadImages = () => {
        const imagesToPreload = [];
        if (currentImageIndex > 0) {
          imagesToPreload.push(images[currentImageIndex - 1]);
        }
        if (currentImageIndex < images.length - 1) {
          imagesToPreload.push(images[currentImageIndex + 1]);
        }
        
        imagesToPreload.forEach(src => {
          const img = new Image();
          img.src = src;
        });
      };
      preloadImages();
    }
  }, [currentImageIndex, images]);

  // Reset state when modal opens/closes or image changes
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setImageLoaded(false);
      setCurrentImageIndex(currentIndex);
      setNavDirection(1);
      swipeStartXRef.current = null;
      swipeStartYRef.current = null;
      swipeHandledRef.current = false;
      swipeDistanceRef.current = 0;
    }
  }, [isOpen, imageUrl, currentIndex]);

  const clampScale = useCallback((value: number) => Math.min(Math.max(value, 0.5), 5), []);

  // Keyboard controls
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      switch(e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (images.length > 0 && currentImageIndex > 0) {
            setNavDirection(-1);
            setCurrentImageIndex(prev => prev - 1);
            setScale(1);
            setPosition({ x: 0, y: 0 });
          }
          break;
        case 'ArrowRight':
          if (images.length > 0 && currentImageIndex < images.length - 1) {
            setNavDirection(1);
            setCurrentImageIndex(prev => prev + 1);
            setScale(1);
            setPosition({ x: 0, y: 0 });
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose, currentImageIndex, images.length]);


  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => clampScale(prev * delta));
  }, [clampScale]);

  // Drag to pan when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }, [isDragging, dragStart, scale]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const [t1, t2] = [touches[0], touches[1]];
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStartOnImage = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length === 2) {
        pinchStartDistanceRef.current = getTouchDistance(e.touches);
        pinchStartScaleRef.current = scale;
        touchPanStartRef.current = null;
      } else if (e.touches.length === 1 && scale > 1) {
        const touch = e.touches[0];
        touchPanStartRef.current = { x: touch.clientX, y: touch.clientY };
        touchPanOriginRef.current = { ...position };
        setIsDragging(true);
      } else if (e.touches.length === 1 && scale === 1) {
        // Start swipe to close tracking
        swipeStartYRef.current = e.touches[0].clientY;
        swipeStartXRef.current = e.touches[0].clientX;
        swipeDistanceRef.current = 0;
        swipeHandledRef.current = false;
      }
    },
    [position, scale],
  );

  const handleTouchMoveOnImage = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDistanceRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const currentDistance = getTouchDistance(e.touches);
        if (currentDistance > 0) {
          const nextScale = clampScale(
            pinchStartScaleRef.current * (currentDistance / pinchStartDistanceRef.current),
          );
          setScale(nextScale);
        }
        return;
      }

      if (e.touches.length === 1 && touchPanStartRef.current && scale > 1) {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.touches[0];
        const dx = touch.clientX - touchPanStartRef.current.x;
        const dy = touch.clientY - touchPanStartRef.current.y;
        setPosition({
          x: touchPanOriginRef.current.x + dx,
          y: touchPanOriginRef.current.y + dy,
        });
      }

      // Handle swipe to close / navigate (image stays in place; only detect gesture)
      if (e.touches.length === 1 && scale === 1 && swipeStartYRef.current !== null) {
        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = currentY - swipeStartYRef.current;
        const deltaX = swipeStartXRef.current !== null ? currentX - swipeStartXRef.current : 0;

        const NAV_THRESHOLD = 45;
        if (!swipeHandledRef.current && images.length > 1 && Math.abs(deltaX) > Math.abs(deltaY) + 8) {
          if (deltaX > NAV_THRESHOLD && currentImageIndex > 0) {
            swipeHandledRef.current = true;
            swipeDistanceRef.current = 0;
            setNavDirection(-1);
            setCurrentImageIndex((prev) => Math.max(0, prev - 1));
            setScale(1);
            setPosition({ x: 0, y: 0 });
            return;
          }
          if (deltaX < -NAV_THRESHOLD && currentImageIndex < images.length - 1) {
            swipeHandledRef.current = true;
            swipeDistanceRef.current = 0;
            setNavDirection(1);
            setCurrentImageIndex((prev) => Math.min(images.length - 1, prev + 1));
            setScale(1);
            setPosition({ x: 0, y: 0 });
            return;
          }
        }

        if (swipeHandledRef.current) {
          return;
        }

        const CLOSE_THRESHOLD = 60;
        if (deltaY > CLOSE_THRESHOLD) {
          swipeHandledRef.current = true;
          swipeDistanceRef.current = deltaY;
          onClose();
        }
      }
    },
    [clampScale, currentImageIndex, images.length, onClose, scale],
  );

  const handleTouchEndOnImage = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length < 2) {
      pinchStartDistanceRef.current = null;
    }
    if (e.touches.length === 0) {
      touchPanStartRef.current = null;
      setIsDragging(false);
      swipeStartYRef.current = null;
      swipeStartXRef.current = null;
      swipeHandledRef.current = false;
      swipeDistanceRef.current = 0;
    }
  }, []);

  // 处理背景点击/触摸关闭
  const handleBackgroundClose = useCallback(() => {
    console.log('Background clicked/touched, closing image preview');
    
    // 立即关闭图片预览
    onClose();
    
    // 阻止事件传播到底层modal
    setTimeout(() => {
      // 临时禁用body的点击事件
      document.body.style.pointerEvents = 'none';
      setTimeout(() => {
        document.body.style.pointerEvents = 'auto';
      }, 500);
    }, 0);
  }, [onClose]);

  const displayImage = images.length > 0 ? images[currentImageIndex] : imageUrl;
  const [mounted, setMounted] = useState(false);
  const imageVariants = {
    enter: (direction: 1 | -1) => ({
      opacity: 0,
      x: direction > 0 ? 60 : -60,
    }),
    center: { opacity: 1, x: 0 },
    exit: (direction: 1 | -1) => ({
      opacity: 0,
      x: direction > 0 ? -60 : 60,
    }),
  };
  const imageTransition = { duration: 0.18, ease: 'easeOut' };

  useEffect(() => {
    setMounted(true);
    const updateIsMobile = () => setIsMobile(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
    updateIsMobile();
    window.addEventListener('resize', updateIsMobile);
    return () => {
      setMounted(false);
      window.removeEventListener('resize', updateIsMobile);
    };
  }, []);

  if (!mounted || !isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 px-0"
          onClick={(e) => {
            console.log('Container clicked', e.target === e.currentTarget);
            // 只有点击背景时才关闭
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
              handleBackgroundClose();
            }
          }}
          onTouchEnd={(e) => {
            console.log('Container touched', e.target === e.currentTarget);
            // 移动端触摸事件处理  
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
              handleBackgroundClose();
            }
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent?.stopImmediatePropagation();
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
          }}
          ref={containerRef}
        >
          {/* Close button */}
          <div 
            className="absolute top-4 left-4 z-10 flex"
            onClick={(e) => {
              e.stopPropagation();
              e.nativeEvent?.stopImmediatePropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.nativeEvent?.stopImmediatePropagation();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              className="rounded-full bg-black/40 p-2 text-white transition-all hover:bg-black/60"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                onClose();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
              }}
              title="Close (ESC)"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>


          {/* Navigation arrows if multiple images */}
          {images.length > 1 && !isMobile && (
            <>
              {currentImageIndex > 0 && (
                <button
                  className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-all hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNavDirection(-1);
                    setCurrentImageIndex(prev => prev - 1);
                    setScale(1);
                    setPosition({ x: 0, y: 0 });
                  }}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {currentImageIndex < images.length - 1 && (
                <button
                  className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-all hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNavDirection(1);
                    setCurrentImageIndex(prev => prev + 1);
                    setScale(1);
                    setPosition({ x: 0, y: 0 });
                  }}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              <div className="absolute bottom-4 right-4 z-10">
                <div className="rounded-full bg-white/10 px-3 py-1 text-sm text-white backdrop-blur">
                  {currentImageIndex + 1} / {images.length}
                </div>
              </div>
            </>
          )}

          {/* Loading indicator */}
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-white/30 border-t-white"></div>
            </div>
          )}

          {/* Image with swipe animation */}
          <div className="relative flex h-full w-full items-center justify-center">
            <AnimatePresence custom={navDirection} mode="wait" initial={false}>
              <motion.div
                key={displayImage}
                custom={navDirection}
                variants={imageVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={imageTransition}
                className="flex items-center justify-center"
              >
                <img
                  ref={imageRef}
                  src={displayImage}
                  alt="Preview"
                  className={`h-auto w-full max-h-[90vh] max-w-full select-none object-contain ${scale > 1 ? 'cursor-move' : 'cursor-pointer'} ${!imageLoaded ? 'opacity-0' : 'opacity-100'}`}
                  style={{
                    transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
                    opacity: 1,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.nativeEvent?.stopImmediatePropagation();
                  }}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onTouchStart={(e) => {
                    handleTouchStartOnImage(e);
                  }}
                  onTouchMove={(e) => {
                    handleTouchMoveOnImage(e);
                  }}
                  onTouchEnd={(e) => {
                    handleTouchEndOnImage(e);
                  }}
                  onLoad={() => setImageLoaded(true)}
                  draggable={false}
                />
              </motion.div>
            </AnimatePresence>
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
