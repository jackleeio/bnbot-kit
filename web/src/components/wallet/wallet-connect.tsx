'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useAccount, useBalance, useDisconnect, useChainId, useChains } from 'wagmi';
import cn from '@/utils/cn';
import { Menu } from '@/components/ui/menu';
import { Transition } from '@/components/ui/transition';
import { PowerIcon } from '@/components/icons/power';
import ethereumIcon from '@/assets/images/chain/ethereum.svg';
import arbitrumIcon from '@/assets/images/chain/arbitrum.svg';
import baseIcon from '@/assets/images/chain/base.svg';
import optimismIcon from '@/assets/images/chain/optimism.svg';
import blastIcon from '@/assets/images/chain/blast.webp';
import zksyncIcon from '@/assets/images/chain/zksync.webp';
import scrollIcon from '@/assets/images/chain/scroll.svg';
import polygonIcon from '@/assets/images/chain/polygon.svg';
import bnbIcon from '@/assets/images/chain/bnb-chain.svg';
import avalanceIcon from '@/assets/images/chain/avalanche.svg';

export default function WalletConnect({
  btnClassName,
  onConnected,
}: {
  btnClassName?: string;
  onConnected?: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address });
  const chainId = useChainId();
  const chains = useChains();
  const currentChain = chains.find((c) => c.id === chainId);
  const connectingRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);

  const truncateAddress = (addr: string, chars = 4) => {
    return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
  };

  const handleConnect = async () => {
    connectingRef.current = true;
    await open();
  };

  useEffect(() => {
    if (isConnected && connectingRef.current) {
      connectingRef.current = false;
      onConnected?.();
    }
  }, [isConnected, onConnected]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const getChainIcon = (id: number): string => {
    const iconMap: { [key: number]: string } = {
      1: ethereumIcon.src,
      10: optimismIcon.src,
      8453: baseIcon.src,
      84532: baseIcon.src,
      42161: arbitrumIcon.src,
      11155111: ethereumIcon.src,
      81457: blastIcon.src,
      324: zksyncIcon.src,
      534352: scrollIcon.src,
      137: polygonIcon.src,
      43114: avalanceIcon.src,
      56: bnbIcon.src,
      97: bnbIcon.src,
    };
    return iconMap[id] || ethereumIcon.src;
  };

  return (
    <>
      {address ? (
        <div className="relative flex items-center">
          <Menu>
            <Menu.Button className="flex h-9 items-center rounded-full border border-gray-200 bg-white pl-0 pr-3 text-sm text-gray-700 transition-colors hover:border-gray-300">
              <div className="relative h-9 w-9 flex-shrink-0 rounded-full">
                <img
                  src={getChainIcon(chainId)}
                  alt="Chain"
                  className="absolute h-full w-full rounded-full object-cover p-1.5"
                />
              </div>
              <span>{truncateAddress(address, 4)}</span>
            </Menu.Button>
            <Transition
              enter="transition-all duration-200 ease-out"
              enterFrom="opacity-0 translate-y-2"
              enterTo="opacity-100 translate-y-0"
              leave="transition-all duration-150 ease-in"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-2"
            >
              <Menu.Items
                className={`rounded-2xl border border-gray-100 bg-white shadow-lg ${
                  isMobile
                    ? 'fixed bottom-3 left-1/2 w-[80%] max-w-[320px] -translate-x-1/2'
                    : 'absolute right-0 top-full mt-2 w-64 origin-top-right'
                }`}
              >
                <Menu.Item>
                  <div className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        Balance
                      </div>
                      <button
                        className="flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-red-500"
                        onClick={() => disconnect()}
                      >
                        <PowerIcon className="h-3.5 w-3.5" />
                        <span>Disconnect</span>
                      </button>
                    </div>
                    <div className="mt-1.5 text-lg font-medium text-gray-900">
                      {balanceData?.formatted?.slice(0, 8) || '0.000'}{' '}
                      {balanceData?.symbol || 'BNB'}
                    </div>
                    <div className="mt-2 break-all text-xs text-gray-400">
                      {address}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1.5">
                        {currentChain && (
                          <img
                            src={getChainIcon(currentChain.id)}
                            alt={currentChain.name}
                            className="h-4 w-4 rounded-full"
                          />
                        )}
                        <span className="text-xs text-gray-600">
                          {currentChain?.name || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      ) : (
        <button
          className={cn(
            'rounded-full bg-[#F0B90B] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e6af0a]',
            btnClassName,
          )}
          onClick={handleConnect}
        >
          Connect
        </button>
      )}
    </>
  );
}
