'use client';

import React, { useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination, Autoplay } from 'swiper/modules';
import { Agent } from './types';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/pagination';

interface AgentsCarouselProps {
  agents: Agent[];
}

const AgentsCarousel: React.FC<AgentsCarouselProps> = ({ agents }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  // Banner images - first three are custom, rest use placeholders
  const getBannerImage = (agent: Agent, index: number) => {
    if (index === 0) {
      return '/banners/bnbot-banner-1-compressed.jpg';
    }
    if (index === 1) {
      return '/banners/bnbot-banner-2-compressed.jpg';
    }
    if (index === 2) {
      return '/banners/bnbot-banner-3.6-compressed.jpg';
    }
    return `https://picsum.photos/seed/${agent.id}/800/600`;
  };

  return (
    <div className="flex w-full flex-col items-center pb-12 pt-4">
      {/* Carousel Section */}
      <div className="relative mx-auto mb-12 w-full max-w-sm px-4 md:max-w-7xl">
        <Swiper
          loop={true}
          spaceBetween={0}
          slidesPerView={1}
          grabCursor={true}
          modules={[Pagination, Autoplay]}
          className="w-[350px] md:w-[900px]"
          pagination={{
            clickable: true,
            el: '.custom-swiper-pagination',
          }}
          autoplay={{ delay: 5000, disableOnInteraction: false }}
          onSlideChange={(swiper) => setActiveIndex(swiper.realIndex)}
        >
          {agents.map((agent, index) => (
            <SwiperSlide
              key={agent.id}
              className="h-auto bg-transparent p-4"
            >
              <div className="group relative w-full overflow-hidden rounded-2xl border-[3px] border-white bg-white shadow-lg aspect-[4/3]">
                <img
                  src={getBannerImage(agent, index)}
                  alt={agent.name}
                  className="h-full w-full object-contain"
                />
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
        <div className="custom-swiper-pagination relative z-10 mt-4 flex justify-center gap-2" />
      </div>
    </div>
  );
};

export default AgentsCarousel;
