import { Metadata } from 'next';
import ClassicLayout from '@/layouts/classic/layout';

export const metadata: Metadata = {
  title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
  description: 'Explore BNBOT\'s specialized AI agents for crypto trading, market analysis, social media insights, and Web3 assistance. Find the perfect AI assistant for your crypto needs.',
  keywords: 'BNBOT agents, crypto AI agents, trading bot, market analysis AI, X agent, X Boost, deep research AI, BNB Chain AI',
  openGraph: {
    title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
    description: 'Explore BNBot\'s specialized AI agents for crypto analysis, market insights, and Web3 growth.',
    url: 'https://bnbot.ai/agent',
    images: [
      {
        url: '/og-agent.png',
        width: 1200,
        height: 630,
        alt: 'BNBOT AI Agents',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
    description: 'Specialized AI agents for crypto growth and Web3 acceleration.',
  },
  alternates: {
    canonical: '/agent',
  },
};

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClassicLayout>{children}</ClassicLayout>;
}