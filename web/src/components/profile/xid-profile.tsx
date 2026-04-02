'use client';

// unused imports removed
import { authorData } from '@/data/static/author';
import { XIcon } from '@/components/icons/x-icon';
// dummy data
import { useCopyToClipboard } from 'react-use';
import { useEffect, useState } from 'react';
import { Check } from '@/components/icons/check';
import { Copy } from '@/components/icons/copy';
import Avatar from '@/components/ui/xid-avatar';

import { useAccount, useChainId } from 'wagmi';

import { useRouter } from 'next/navigation';
import {
  ArrowRightStartOnRectangleIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'; // Import LogOut icon

interface User {
  id: string;
  username: string;
  name: string;
  avatar: string;
  email?: string;
}

interface Props {
  userData: User | null;
  xidAddress: `0x${string}` | undefined;
  loading: boolean;
}

export default function RetroProfile({ userData, xidAddress, loading }: Props) {
  const [copyButtonStatus, setCopyButtonStatus] = useState(false);
  const [_, copyToClipboard] = useCopyToClipboard();
  const router = useRouter();
  const chainId = useChainId();

  const xUsername = userData?.email;
  const xAvatar = userData?.avatar;

  function handleCopyToClipboard() {
    copyToClipboard(authorData.wallet_key);
    setCopyButtonStatus(true);
    setTimeout(() => {
      setCopyButtonStatus(copyButtonStatus);
    }, 2500);
  }

  const handleLogout = async () => {
    localStorage.removeItem('userData.bnbot');
    localStorage.removeItem('accessToken.bnbot');
    localStorage.removeItem('refreshToken.bnbot');
    router.push('/login');
  };

  const getBlockExplorerUrl = (chainId: number, address: string) => {
    switch (chainId) {
      // Mainnets
      case 1: // Ethereum Mainnet
        return `https://etherscan.io/address/${address}`;
      case 10: // Optimism
        return `https://optimistic.etherscan.io/address/${address}`;
      case 8453: // Base
        return `https://basescan.org/address/${address}`;
      case 1030: // Conflux eSpace
        return `https://evm.confluxscan.io/address/${address}`;

      // Testnets
      case 11155111: // Sepolia
        return `https://sepolia.etherscan.io/address/${address}`;
      case 420: // Optimism Goerli
        return `https://goerli-optimism.etherscan.io/address/${address}`;
      case 84531: // Base Goerli
        return `https://goerli.basescan.org/address/${address}`;
      case 71: // Conflux eSpace Testnet
        return `https://evmtestnet.confluxscan.io/address/${address}`;

      // Add more networks as needed

      default:
        return `https://etherscan.io/address/${address}`;
    }
  };

  const address = xidAddress || null;

  // Update showSkeleton logic
  const [showSkeleton, setShowSkeleton] = useState(true);

  useEffect(() => {
    if (userData && !loading) {
      setShowSkeleton(false);
    }
  }, [userData, loading]);

  const formatAddress = (address: string) => {
    return `${address.substring(0, 12)}...${address.substring(address.length - 6)}`;
  };

  if (showSkeleton) {
    return (
      <div className="relative w-full pt-1">
        {/* Skeleton loading state */}
        <div className="skeleton absolute -top-[68px] left-0 z-10 mb-4 h-32 w-32 rounded-full border-4 border-white shadow-sm"></div>

        <div className="mt-20 flex w-full flex-col items-start md:flex-row">
          {/* Name skeleton */}
          <div className="-mt-1 text-left">
            <div className="skeleton h-8 w-32"></div>
          </div>

          {/* Icons skeleton */}
          <div className="ml-auto mt-0 flex items-center md:-mt-1">
            <div className="skeleton mr-2 h-8 w-8 rounded-full"></div>
            <div className="skeleton mr-2 h-8 w-8 rounded-full"></div>
            <div className="skeleton h-8 w-8 rounded-full"></div>
          </div>
        </div>

        {/* Address bar skeleton */}
        <div className="px-4 sm:px-0">
          <div className="skeleton mb-8 mt-3 h-9 w-full rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full pt-3">
      <Avatar
        size="xl"
        image={xAvatar || ''}
        alt={userData?.name || ''}
        width={200}
        height={200}
        className="z-10 mx-auto -mt-16 bg-white sm:-mt-14 md:mx-0 md:-mt-20 xl:mx-0 3xl:-mt-20"
      />
      <div className="mt-3 flex w-full flex-col items-center md:flex-row">
        <div className="text-center ltr:md:text-left rtl:md:text-right">
          <h2 className="pl-3 text-xl font-medium tracking-tighter text-gray-900 dark:text-white xl:text-2xl">
            {userData?.name || 'XXXXXX'}
          </h2>
        </div>
        <div className="flex items-center ltr:md:ml-auto rtl:md:mr-auto">
          {address && (
            <a
              href={getBlockExplorerUrl(chainId, address)}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer rounded-full text-black transition hover:bg-slate-100 dark:hover:text-white"
              aria-label="View on Block Explorer"
            >
              <div className="rounded-full p-2">
                <LinkIcon className="h-6 w-6" />
              </div>
            </a>
          )}
          <a
            className="cursor-pointer rounded-full text-gray-500 transition hover:bg-slate-100 dark:hover:text-white"
            href={`https://x.com/${xUsername}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="rounded-full p-2.5">
              <XIcon className="relative h-5 w-5" />
            </div>
          </a>
          <button
            onClick={handleLogout}
            className="cursor-pointer rounded-full text-black transition hover:bg-slate-100 dark:hover:text-white"
            aria-label="Logout"
          >
            <div className="rounded-full p-2">
              <ArrowRightStartOnRectangleIcon className="h-6 w-6" />
            </div>
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-0">
        {' '}
        {/* Add horizontal padding on mobile */}
        {address ? (
          <div className="mx-auto mb-8 mt-3 flex h-9 w-full items-center rounded-full border border-black bg-white">
            <div className="flex h-full shrink-0 items-center rounded-full bg-gray-900 px-4 text-xs text-white sm:text-sm">
              @{xUsername || 'Loading...'}
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden px-2">
              <div className="hidden truncate text-ellipsis text-center text-sm text-black sm:text-sm md:block">
                {address}
              </div>
              <div className="block truncate text-ellipsis text-center text-sm text-black sm:text-sm md:hidden">
                {address ? formatAddress(address) : 'Loading...'}
              </div>
            </div>
            <div
              className="flex h-full shrink-0 cursor-pointer items-center px-4 transition hover:text-slate-800"
              title="Copy Address"
              onClick={() => handleCopyToClipboard()}
            >
              {copyButtonStatus ? (
                <Check className="h-auto w-3.5 text-green-500" />
              ) : (
                <Copy className="h-auto w-3.5" />
              )}
            </div>
          </div>
        ) : (
          <div className="mb-8 mt-3 flex h-9 w-full items-center justify-between rounded-full bg-white dark:bg-light-dark">
            <div className="flex h-full shrink-0 grow-0 items-center rounded-full border-0 bg-slate-100 px-4 text-xs text-black sm:text-sm">
              @{xUsername || 'Loading...'}
            </div>
            <button
              className="btn btn-sm flex h-full shrink-0 grow-0 items-center rounded-full bg-black px-4 text-xs font-light text-white hover:bg-slate-800 sm:text-sm"
              onClick={() => router.push('/')}
            >
              <span className="block md:hidden">Create Your XID</span>
              <span className="hidden md:block">
                Link Your 𝕏 Handle On-Chain
              </span>
            </button>
          </div>
        )}
      </div>
      {/* <div className={`grow pb-9 pt-6 md:pb-0 ${!address ? 'blur-sm' : ''}`}>
        <ProfileTab />
      </div> */}
    </div>
  );
}
