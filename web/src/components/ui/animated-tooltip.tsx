import Image from 'next/image';
import React, { useState } from 'react';
import {
  motion,
  useTransform,
  AnimatePresence,
  useMotionValue,
  useSpring,
} from 'framer-motion';

interface RetweetUser {
  rest_id: string;
  name: string;
  username: string;
  avatar: string;
  is_verified: boolean;
  is_blue_verified: boolean;
  followers_count: number;
  following_count: number;
  friends_count: number;
  tweet_count: number;
  media_count: number;
  description: string;
  location: string;
  created_at: string;
}


export const AnimatedTooltip = ({ users }: { users: RetweetUser[] }) => {
  const [hoveredIndex, setHoveredIndex] = useState<string | null>(null);
  const springConfig = { stiffness: 100, damping: 5 };
  const x = useMotionValue(0);
  const rotate = useSpring(
    useTransform(x, [-100, 100], [-45, 45]),
    springConfig,
  );
  const translateX = useSpring(
    useTransform(x, [-100, 100], [-50, 50]),
    springConfig,
  );

  const handleMouseMove = (event: React.MouseEvent<HTMLImageElement>) => {
    const halfWidth = event.currentTarget.offsetWidth / 2;
    x.set(event.nativeEvent.offsetX - halfWidth);
  };

  const displayUsers = users.slice(0, 100);
  const hasMoreUsers = users.length > 100;

  return (
    <div className="flex flex-wrap justify-center gap-1">
      {displayUsers.map((user) => (
        <div
          className="group relative -mr-4"
          key={user.rest_id}
          onMouseEnter={() => setHoveredIndex(user.rest_id)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <Image
            onMouseMove={handleMouseMove}
            height={32}
            width={32}
            src={user.avatar}
            alt={user.name}
            unoptimized
            className="relative h-8 w-8 rounded-full border-2 border-white object-cover transition duration-500 group-hover:z-30 group-hover:scale-105"
            style={{ objectFit: 'cover' }}
          />
        </div>
      ))}
      {hasMoreUsers && (
        <div className="ml-3 flex h-8 w-8 items-center justify-center text-sm text-black">
          ...
        </div>
      )}
    </div>
  );
};
