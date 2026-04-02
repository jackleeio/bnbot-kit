'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTranslations, useLocale } from 'next-intl';
import { SparklesIcon, ChatBubbleLeftRightIcon, FireIcon, LightBulbIcon, EyeIcon } from '@heroicons/react/24/outline';
import Image from '@/components/ui/image';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import bitcoinLogo from '@/assets/images/currency/bitcoin.svg';
import { useNotification } from '@/context/notification-context';


import { Agent, mockAgents } from '@/data/agents';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  // const [selectedCategory, setSelectedCategory] = useState<string>('All');
  // const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const { showNotification } = useNotification();
  const t = useTranslations('agent');
  const locale = useLocale();

  // 获取翻译后的描述
  const getAgentDescription = (agentId: string, fallback: string) => {
    const descMap: { [key: string]: string } = {
      'crypto-analyst': t('xTrendPulse.description'),
      'boost-agent': t('boostAgent.description'),
      'x-agent': t('xAgent.description'),
      'x-insight': t('xInsight.description'),
    };
    return descMap[agentId] || fallback;
  };

  useEffect(() => {
    setAgents(mockAgents);
  }, []);

  // const allCategories = Array.from(new Set(agents.map(agent => agent.category)));
  // Put All first, then X Agent, then other categories
  // const categories = ['All', 'X Agent', ...allCategories.filter(cat => cat !== 'X Agent')];

  // Show all agents since search and filter are commented out
  const filteredAgents = agents;

  const handleAgentClick = (agent: Agent) => {
    if (agent.id === 'crypto-analyst') {
      // X Trend 直接跳转到 /chat
      router.push('/chat');
    } else if (agent.id === 'x-agent') {
      router.push('/x-agent');
    } else {
      // 其他 agent 暂时显示 Coming Soon
      showNotification({
        title: 'Coming Soon!',
        msg: `${agent.name} agent is under development and will be available soon.`,
        type: 'warning',
        icon: <span></span>
      });
    }
  };

  return (
    <div className="min-h-screen px-2 py-8 sm:px-4 lg:px-6 flex items-center">
      <div className="mx-auto max-w-7xl w-full">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-10">
          <motion.div
            className="inline-block p-4 rounded-full bg-gradient-to-r from-[#f0b90b]/20 to-[#e6af0a]/20 mb-6 relative"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            {/* Animated glowing ring - slower animation */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#f0b90b] to-[#e6af0a] opacity-40 blur-md animate-pulse-slow"></div>
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#f0b90b] to-[#e6af0a] opacity-20 animate-ping-slow"></div>

            <Image
              src={bnbotAI}
              alt="BNBOT AI - X Trend Platform Logo"
              width={64}
              height={64}
              className="rounded-full relative z-10"
            />
          </motion.div>
          <motion.h1
            className="text-lg sm:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-2 sm:mb-5 tracking-wide"
            style={{ fontFamily: 'Orbitron, monospace' }}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            {t('headline')}
          </motion.h1>
          <motion.p
            className="text-sm sm:text-base text-gray-600 max-w-3xl mx-auto leading-relaxed"
            style={{ fontFamily: '"Exo 2", sans-serif' }}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            {t('subheadline')}<br />
            {/* From trading analysis to viral memes and marketing, get AI-powered insights and brand growth boost. */}
          </motion.p>
        </div>

        {/* Search and Filter */}
        {/* <motion.div 
          className="mb-6 py-6 px-4 sm:p-6 sm:bg-white/60 sm:backdrop-blur-sm sm:rounded-2xl sm:shadow-sm sm:border sm:border-white/20"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-none sm:max-w-xs mx-0 sm:mx-0 sm:flex-1 sm:mr-6">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="SEARCH AGENTS..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 sm:py-3 border border-gray-200 rounded-xl bg-white/80 backdrop-blur-sm focus:ring-2 focus:ring-[#f0b90b]/30 focus:border-[#f0b90b] transition-all duration-200 shadow-sm text-sm"
                style={{ fontFamily: '"Exo 2", sans-serif' }}
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-start sm:flex-nowrap sm:flex-shrink-0">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs font-medium transition-all duration-150 whitespace-nowrap border tracking-wide ${
                    selectedCategory === category
                      ? 'bg-gradient-to-r from-[#f0b90b] to-[#e6af0a] text-white shadow-lg shadow-[#f0b90b]/25 border-[#f0b90b]'
                      : 'bg-white/80 text-gray-700 border-gray-200 hover:bg-white hover:shadow-md hover:border-gray-300 backdrop-blur-sm'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </motion.div> */}

        {/* Agents Grid */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          {filteredAgents.map((agent, index) => (
            <motion.div
              key={agent.id}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 cursor-pointer group overflow-hidden relative"
              onClick={() => handleAgentClick(agent)}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: index * 0.1,
                // 默认的动画设置（用于悬浮结束后）
                default: { duration: 0.1, ease: "easeOut" }
              }}
              whileHover={{
                scale: 1.02,
                y: -8,
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(240, 185, 11, 0.1)",
                transition: { duration: 0.15, ease: "easeOut" }
              }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Background gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#f0b90b]/5 via-transparent to-[#e6af0a]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              <div className="relative z-10 flex flex-col h-full">
                <div className="flex items-center sm:items-start space-x-4 mb-4">
                  <div className="w-16 h-16 p-3 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 group-hover:from-[#f0b90b]/10 group-hover:to-[#e6af0a]/10 transition-colors duration-300 flex items-center justify-center">
                    {agent.id === 'crypto-analyst' ? (
                      <Image
                        src={bitcoinLogo}
                        alt="Bitcoin Agent Logo for BNBOT X Trend"
                        width={40}
                        height={40}
                        className="object-contain"
                      />
                    ) : agent.id === 'x-agent' ? (
                      <span className="text-4xl font-bold">X</span>
                    ) : (
                      <span className="text-5xl">{agent.avatar}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-md font-semibold text-gray-900 transition-colors duration-300 tracking-wide">
                        {agent.name}
                      </h3>
                      <div className={`w-3 h-3 rounded-full ${agent.id === 'crypto-analyst'
                        ? 'bg-green-500'
                        : 'bg-yellow-500'
                        }`}>
                        {agent.id === 'crypto-analyst' && (
                          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                        )}
                        {agent.id !== 'crypto-analyst' && (
                          <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse"></div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2 sm:hidden">
                      {agent.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className={`px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full transition-colors duration-300 font-exo2 ${locale === 'en' ? 'text-xs font-medium' : 'text-[11px]'}`}
                        >
                          {t(`tags.${tag}`)}
                        </span>
                      ))}
                      {agent.tags.length > 3 && (
                        <span className="px-2 py-0.5 text-sm font-medium bg-gray-100 text-gray-500 rounded-full font-exo2">
                          +{agent.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-sm text-gray-500 mb-0 sm:mb-4 line-clamp-3 leading-relaxed font-light font-exo2 flex-1">
                  {getAgentDescription(agent.id, agent.description)}
                </p>

                <div className="hidden sm:flex flex-wrap gap-1.5 mt-auto">
                  {agent.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className={`px-2.5 py-0.5 bg-gray-100 text-gray-700 rounded-full transition-colors duration-300 font-exo2 ${locale === 'en' ? 'text-xs font-medium' : 'text-[11px]'}`}
                    >
                      {t(`tags.${tag}`)}
                    </span>
                  ))}
                  {agent.tags.length > 3 && (
                    <span className="px-2.5 py-0.5 text-sm font-medium bg-gray-100 text-gray-500 rounded-full font-exo2">
                      +{agent.tags.length - 3}
                    </span>
                  )}
                </div>

              </div>
            </motion.div>
          ))}
        </motion.div>

        {filteredAgents.length === 0 && (
          <motion.div
            className="text-center py-20"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-block p-6 rounded-full bg-gradient-to-r from-gray-100 to-gray-200 mb-6">
              <div className="text-6xl">🔍</div>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">No agents found</h3>
            <p className="text-gray-600 text-lg mb-8 max-w-md mx-auto">
              Try adjusting your search terms or filter criteria to find the perfect agent for your needs.
            </p>
            {/* Reset button removed since search is commented out */}
          </motion.div>
        )}
      </div>
    </div>
  );
}
