'use client';

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bsc, bscTestnet } from '@reown/appkit/networks';
import { useEffect } from 'react';

export const projectId = process.env.NEXT_PUBLIC_CRYPTO_PROJECT_ID || '';

const metadata = {
  name: 'BNBot',
  description: 'Boost your tweets on BNBot',
  url: 'https://bnbot.ai',
  icons: ['https://avatars.githubusercontent.com/u/179229932'],
};

const wagmiAdapter = new WagmiAdapter({
  networks: [bsc, bscTestnet],
  projectId,
  ssr: true,
});

createAppKit({
  adapters: [wagmiAdapter],
  defaultNetwork: bsc,
  networks: [bsc, bscTestnet],
  metadata: metadata,
  projectId,
  enableWalletConnect: false,
  allowUnsupportedChain: true,
  enableEIP6963: true,
  enableInjected: true,
  allWallets: 'HIDE',
  features: {
    analytics: false,
    email: false,
    socials: [],
    emailShowWallets: false,
  },
  themeMode: 'light',
  themeVariables: {
    '--apkt-border-radius-master': '4px',
  },
  featuredWalletIds: [
    "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
    "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
    "8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d4", // Binance Wallet
  ],
});

const queryClient = new QueryClient();

function hideUnwantedElements() {
  try {
    const processInShadow = (root: Document | ShadowRoot) => {
      // Hide Reown branding elements
      root.querySelectorAll('w3m-legal-footer, w3m-legal-checkbox, wui-ux-by-reown').forEach(
        (el) => ((el as HTMLElement).style.display = 'none'),
      );
      // Hide WalletConnect option by checking text content
      root.querySelectorAll('wui-list-wallet').forEach((el) => {
        if (el.getAttribute('name')?.toLowerCase().includes('walletconnect')) {
          (el as HTMLElement).style.display = 'none';
        }
      });
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) processInShadow(el.shadowRoot);
      });
    };
    document.querySelectorAll('w3m-modal, appkit-modal').forEach((modal) => {
      if (modal.shadowRoot) processInShadow(modal.shadowRoot);
    });
  } catch {
    // silent
  }
}

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    const observer = new MutationObserver(() => {
      const hasModal = document.querySelector('w3m-modal, appkit-modal');
      if (hasModal && !interval) {
        interval = setInterval(hideUnwantedElements, 50);
      } else if (!hasModal && interval) {
        clearInterval(interval);
        interval = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
    return () => {
      observer.disconnect();
      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
