import { Metadata } from 'next';
import ClassicLayout from '@/layouts/classic/layout';

export const metadata: Metadata = {
  title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
  description: 'Chat with BNBot, the AI × Crypto Growth Agent. Get real-time market analysis, growth insights, and Web3 acceleration powered by advanced AI technology.',
  keywords: 'BNBot chat, crypto AI agent, growth network, market analysis, Web3 acceleration, AI trading, BNB Chain, blockchain intelligence',
  openGraph: {
    title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
    description: 'Amplify your crypto growth with BNBot. Real-time AI analysis, growth insights, and Web3 acceleration.',
    url: 'https://bnbot.ai/chat',
    images: [
      {
        url: '/og-chat.png',
        width: 1200,
        height: 630,
        alt: 'BNBot - AI × Crypto Growth Network',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
    description: 'Amplify your crypto growth with AI-powered insights and Web3 acceleration.',
  },
  alternates: {
    canonical: '/chat',
  },
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClassicLayout>{children}</ClassicLayout>;
}