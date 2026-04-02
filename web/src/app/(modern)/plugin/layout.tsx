import { Metadata } from 'next';


export const metadata: Metadata = {
  title: 'X Agent – AI-Powered Tweet Composer | BNBot',
  description: 'Generate, edit, and preview tweets with X Agent. AI-powered tweet composition and social media content creation for crypto and Web3.',
  keywords: 'X Agent, tweet generator, AI tweets, social media AI, crypto tweets, Web3 content, BNBot, Twitter automation',
  openGraph: {
    title: 'X Agent – AI-Powered Tweet Composer | BNBot',
    description: 'Generate and preview tweets with AI assistance. Professional social media content creation for crypto and Web3.',
    url: 'https://bnbot.ai/x-agent',
    images: [
      {
        url: '/og-chat.png',
        width: 1200,
        height: 630,
        alt: 'X Agent - AI Tweet Composer',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'X Agent – AI-Powered Tweet Composer | BNBot',
    description: 'Generate professional tweets with AI assistance for crypto and Web3.',
  },
  alternates: {
    canonical: '/x-agent',
  },
};


export default function XAgentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>;
}