import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/20/solid';
import { useChainId, useSwitchChain, useChains } from 'wagmi';
import ethereumIcon from '@/assets/images/chain/ethereum.svg'
import arbitrumIcon from '@/assets/images/chain/arbitrum.svg'
import baseIcon from '@/assets/images/chain/base.svg'
import optimismIcon from '@/assets/images/chain/optimism.svg'
import blastIcon from '@/assets/images/chain/blast.webp'
import zksyncIcon from '@/assets/images/chain/zksync.webp'
import scrollIcon from '@/assets/images/chain/scroll.svg'
import polygonIcon from '@/assets/images/chain/polygon.svg'
import bnbIcon from '@/assets/images/chain/bnb-chain.svg'
import avalanceIcon from '@/assets/images/chain/avalanche.svg'

interface Network {
  name: string;
  icon: string;
  chainId: number;
  isTestnet?: boolean;
}

const NetworkSelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedNetwork, setSelectedNetwork] = useState<Network | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isChangingNetwork, setIsChangingNetwork] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const chains = useChains();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isTestnetEnv = process.env.NEXT_PUBLIC_IS_TESTNET === 'true';

  const getChainIcon = (chainId: number): string => {
    const iconMap: {[key: number]: string} = {
      1: ethereumIcon.src, // Ethereum
      10: optimismIcon.src, // Optimism
      8453: baseIcon.src, // Base
      42161: arbitrumIcon.src, // Arbitrum One
      11155111: ethereumIcon.src, // Sepolia
      81457: blastIcon.src, // Blast
      324: zksyncIcon.src, // ZkSync
      534352: scrollIcon.src, // Scroll
      137: polygonIcon.src, // Polygon
      43114: avalanceIcon.src, // Avalanche
      56: bnbIcon.src, // BNB
    };
    return iconMap[chainId] || ethereumIcon.src; // Default to Ethereum icon
  };

  const networks: Network[] = useMemo(() => {
    const filteredChains = chains.filter(chain => 
      isTestnetEnv ? chain.testnet : !chain.testnet
    );
    
    return filteredChains.map(chain => ({
      name: chain.name,
      icon: getChainIcon(chain.id),
      chainId: chain.id,
      isTestnet: chain.testnet,
    }));
  }, [chains, isTestnetEnv]);

  useEffect(() => {
    const currentNetwork = networks.find(
      (network) => network.chainId === chainId,
    );
    if (currentNetwork) {
      setSelectedNetwork(currentNetwork);
    } else if (networks.length > 0) {
      setSelectedNetwork(networks[0]);
    }
  }, [chainId, networks]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const toggleDropdown = (): void => setIsOpen(!isOpen);

  const selectNetwork = async (network: Network): Promise<void> => {
    if (network.chainId === chainId) {
      setIsOpen(false);
      return;
    }

    setIsChangingNetwork(true);
    setError(null);

    try {
      if (switchChain) {
        await switchChain({ chainId: network.chainId });
        console.log(`Successfully switched to ${network.name}`);
      } else {
        throw new Error('Chain switching is not available');
      }
    } catch (error) {
      console.error('Failed to switch chain:', error);
      setError('Failed to switch network. Please try again.');
      const currentNetwork = networks.find(n => n.chainId === chainId);
      if (currentNetwork) {
        setSelectedNetwork(currentNetwork);
      }
    } finally {
      setIsChangingNetwork(false);
      setIsOpen(false);
    }
  };

  const filteredNetworks = networks.filter((network) =>
    network.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  if (!selectedNetwork) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center justify-between rounded-3xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        disabled={isChangingNetwork}
      >
        <span className="flex items-center">
          <span className="flex-shrink-0 mr-2 rounded-full bg-gray-100 p-0.5">
            <img src={selectedNetwork.icon} alt={selectedNetwork.name} className="w-5 h-5 rounded-full" />
          </span>
          <span className="truncate">{selectedNetwork.name}</span>
        </span>
        <ChevronDownIcon className="ml-2 h-5 w-5" aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-64 rounded-3xl bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2 pt-3">
            <div className="flex items-center rounded-3xl bg-gray-100">
              <MagnifyingGlassIcon className="ml-2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search Network"
                className="w-full border-none bg-transparent px-2 py-2 text-sm focus:ring-0"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <ul className="max-h-60 overflow-auto rounded-b-3xl py-1 text-base sm:text-sm">
            {filteredNetworks.map((network) => (
              <li
                key={network.name}
                className="relative cursor-pointer select-none py-2 pl-3 pr-9 hover:bg-gray-100"
                onClick={() => selectNetwork(network)}
              >
                <div className="flex items-center">
                  <span className="flex-shrink-0 mr-2 rounded-full bg-gray-100 p-0.5">
                    <img src={network.icon} alt={network.name} className="w-5 h-5 rounded-full" />
                  </span>
                  <span className="block truncate font-normal">
                    {network.name}
                  </span>
                  {network.isTestnet && (
                    <span className="ml-2 text-xs text-gray-500">
                      - Testnet
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="absolute mt-1 rounded-md bg-red-100 p-2 text-sm text-red-500">
          {error}
        </div>
      )}
      {isChangingNetwork && (
        <div className="absolute mt-1 rounded-md bg-blue-100 p-2 text-sm text-blue-500">
          Switching network...
        </div>
      )}
    </div>
  );
};

export default NetworkSelector;