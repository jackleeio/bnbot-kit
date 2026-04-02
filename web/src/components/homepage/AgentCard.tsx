'use client';

import React from 'react';
import { Agent } from './types';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import bitcoinLogo from '@/assets/images/currency/bitcoin.svg';

interface AgentCardProps {
  agent: Agent;
  index: number;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent, index }) => {
  const Icon = agent.icon;

  const statusColorMap: Record<string, string> = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  // Render icon based on agent id to match /agent page
  const renderIcon = () => {
    if (agent.id === 'crypto-analyst') {
      return (
        <Image
          src={bitcoinLogo}
          alt="Bitcoin Agent Logo"
          width={40}
          height={40}
          className="object-contain"
        />
      );
    } else if (agent.id === 'x-agent') {
      return <span className="text-4xl font-bold">X</span>;
    } else {
      return <span className="text-5xl">{agent.avatar}</span>;
    }
  };


  const CardContent = (
    <motion.div
      className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 cursor-pointer group overflow-hidden relative h-full"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.1,
        default: { duration: 0.1, ease: "easeOut" }
      }}
      whileHover={{
        scale: 1.02,
        y: -8,
        transition: { duration: 0.15, ease: "easeOut" }
      }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Background gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#f0b90b]/5 via-transparent to-[#e6af0a]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center sm:items-start space-x-4 mb-4">
          <div className="w-16 h-16 p-3 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 group-hover:from-[#f0b90b]/10 group-hover:to-[#e6af0a]/10 transition-colors duration-300 flex items-center justify-center">
            {renderIcon()}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-md font-semibold text-gray-900 transition-colors duration-300 tracking-wide">
                {agent.name}
              </h3>
              <div className="relative">
                <div className={`w-3 h-3 rounded-full ${statusColorMap[agent.statusColor] || 'bg-slate-400'}`}></div>
                <div className={`absolute inset-0 w-3 h-3 rounded-full ${statusColorMap[agent.statusColor] || 'bg-slate-400'} animate-pulse opacity-75`}></div>
              </div>
            </div>
            {/* Mobile tags hidden on desktop in original, but keeping here for consistency */}
            <div className="flex flex-wrap gap-1.5 mb-2 sm:hidden">
              {agent.tags.slice(0, 3).map((tag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-rajdhani transition-colors duration-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-0 sm:mb-4 line-clamp-3 leading-relaxed font-light font-exo2 flex-1" style={{ fontFamily: '"Exo 2", sans-serif' }}>
          {agent.description}
        </p>

        <div className="hidden sm:flex flex-wrap gap-1.5 mt-auto">
          {agent.tags.map((tag, idx) => (
            <span
              key={idx}
              className="px-2.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-rajdhani font-medium transition-colors duration-300"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );

  if (agent.link) {
    return (
      <Link href={agent.link} className="block h-full">
        {CardContent}
      </Link>
    );
  }

  return CardContent;
};

export default AgentCard;
