import cn from '@/utils/cn';
import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getLocale } from 'next-intl/server';
import WalletProvider from './shared/wallet-provider';
import { ThemeProvider } from '@/app/shared/theme-provider';
import { QueryProvider } from './shared/query-client-provider';
import DrawersContainer from '@/components/drawer-views/container';
import { chirp, pressStart2P } from './fonts';
import { AuthCodeExchange } from '@/components/auth/auth-code-exchange';
import { LocaleProvider } from '@/context/locale-context';
import { AuthProvider } from '@/lib/hooks/AuthProvider';

// base css file
import 'overlayscrollbars/overlayscrollbars.css';
import 'swiper/css';
import 'swiper/css/pagination';
import '@/assets/css/scrollbar.css';
import '@/assets/css/globals.css';
import '@/assets/css/range-slider.css';

import { NotificationProvider } from '@/context/notification-context';
import { Modal } from '@/components/ui/animated-modal';

export const metadata: Metadata = {
  title: 'BNBot – Your AI Growth Agent for X',
  description: 'BNBot is the AI × Crypto Growth Agent on BNB Chain. Amplify your crypto presence with intelligent tools, growth insights, and Web3 acceleration.',
  keywords: 'BNBOT, crypto AI agent, BNB Chain, Web3 AI, cryptocurrency assistant, AI trading, blockchain AI, DeFi assistant, crypto intelligence, BNBOT AI',
  authors: [{ name: 'BNBOT Team' }],
  creator: 'BNBOT',
  publisher: 'BNBOT',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL('https://bnbot.ai'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
    description: 'Amplify your crypto growth with BNBot. AI-powered insights, market analysis, and Web3 acceleration on BNB Chain.',
    url: 'https://bnbot.ai',
    siteName: 'BNBOT',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'BNBOT - AI Crypto Assistant',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BNBot (Boost N Bot) – The Next AI × Crypto Growth Agent',
    description: 'Amplify your crypto growth with AI-powered insights and Web3 acceleration.',
    creator: '@BNBOT',
    images: ['/twitter-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icons/bnbot-new-logo-sm.png',
    shortcut: '/icons/bnbot-new-logo-sm.png',
    apple: '/icons/bnbot-new-logo-sm.png',
    other: {
      rel: 'apple-touch-icon-precomposed',
      url: '/apple-touch-icon-precomposed.png',
    },
  },
  manifest: '/manifest.json',
  verification: {
    google: 'google-site-verification-code',
    yandex: 'yandex-verification-code',
    yahoo: 'yahoo-site-verification-code',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} dir="ltr" className={cn('light', chirp.variable, pressStart2P.variable)} suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" type="image/png" href="/favicon-16x16.png" sizes="16x16" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* <meta name="apple-mobile-web-app-status-bar-style" content="white" /> */}
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: dark)"
        />

        {/* Additional SEO Meta Tags */}
        <meta name="application-name" content="BNBOT" />
        <meta name="apple-mobile-web-app-title" content="BNBOT" />
        <meta name="msapplication-TileColor" content="#f0b90b" />
        <meta name="msapplication-config" content="/browserconfig.xml" />

        {/* Structured Data for Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'BNBOT',
              url: 'https://bnbot.ai',
              logo: 'https://bnbot.ai/logo.png',
              description: 'BNBOT is the leading AI-powered crypto assistant platform on BNB Chain, providing intelligent analysis and Web3 assistance.',
              sameAs: [
                'https://x.com/bnbot_ai',
                'https://t.me/BNBOT',
              ],
            }),
          }}
        />

        {/* Structured Data for WebApplication */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'BNBOT AI Assistant',
              url: 'https://bnbot.ai',
              applicationCategory: 'FinanceApplication',
              operatingSystem: 'Any',
              description: 'AI-powered cryptocurrency analysis and trading assistant for BNB Chain and Web3.',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: '4.8',
                ratingCount: '1250',
              },
            }),
          }}
        />

        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&family=Exo+2:wght@300;400;500;600;700&family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        {/* Google Identity Services */}
        <script src="https://accounts.google.com/gsi/client" async defer></script>
      </head>
      <body suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Force light theme
              document.documentElement.className = 'light';
              document.documentElement.style.colorScheme = 'light';
              
              // Prevent theme switching
              if (typeof Storage !== 'undefined') {
                localStorage.setItem('theme', 'light');
              }
            `,
          }}
        />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LocaleProvider initialLocale={locale as 'en' | 'zh'}>
            <AuthProvider>
            <WalletProvider>
              <QueryProvider>
                <ThemeProvider>
                  {/* <SettingsButton />
                  <SettingsDrawer />  */}
                  <NotificationProvider>
                    <AuthCodeExchange />
                    <Modal>
                      {children}
                      {/* <PWARegister /> */}
                    </Modal>
                  </NotificationProvider>
                  {/* DrawersContainer rendered last to ensure it's on top of everything */}
                  <Suspense fallback={null}>
                    {/* <ModalsContainer /> */}
                    <DrawersContainer />
                  </Suspense>
                </ThemeProvider>
              </QueryProvider>
            </WalletProvider>
            </AuthProvider>
          </LocaleProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
