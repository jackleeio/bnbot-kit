'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AssetCard from '@/components/boost/mini-boost-card';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import Masonry from 'react-masonry-css';
import {
  searchBoosts,
  type BoostPublic,
  type BoostStatus,
} from '@/lib/boost-api';
import { useAuth } from '@/lib/hooks/useAuth';
import LoginModal from '@/components/login/login-modal';
import ProfileButton from '@/components/xid/profile-button';
import WalletConnect from '@/components/wallet/wallet-connect';

const STATUS_OPTIONS: { label: string; value: BoostStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
];

export default function BoostListPage() {
  const { user, logout, isLoading: isAuthLoading } = useAuth();
  const [boosts, setBoosts] = useState<BoostPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStatus, setActiveStatus] = useState<BoostStatus | 'all'>('all');
  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchContainerRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement | null>(null);
  const debounceRef = useRef<NodeJS.Timeout>();


  const fetchBoosts = useCallback(
    async (q?: string, status?: BoostStatus | 'all') => {
      setLoading(true);
      setError(null);
      try {
        const params: Parameters<typeof searchBoosts>[0] = {
          limit: 100,
          sort_by: 'created_at',
          sort_order: 'desc',
        };
        if (q) params.q = q;
        if (status && status !== 'all') params.status = status;
        const result = await searchBoosts(params);
        setBoosts(result.data);
      } catch (err) {
        setError('Failed to load boosts. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial fetch & status change
  useEffect(() => {
    fetchBoosts(searchQuery, activeStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchBoosts(searchQuery, activeStatus);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Scroll hide/show search bar
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > 150) {
        setIsSearchVisible(currentScrollY < lastScrollY);
      } else {
        setIsSearchVisible(true);
      }
      setLastScrollY(currentScrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    if (!isSearchVisible) setIsMobileSearchOpen(false);
  }, [isSearchVisible]);

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!isFilterOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFilterOpen]);

  useEffect(() => {
    if (isMobileSearchOpen) mobileSearchInputRef.current?.focus();
  }, [isMobileSearchOpen]);

  useEffect(() => {
    if (!isMobileSearchOpen) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        !mobileSearchContainerRef.current?.contains(target) &&
        !mobileSearchButtonRef.current?.contains(target)
      ) {
        setIsMobileSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isMobileSearchOpen]);

  const breakpointColumnsObj = {
    default: 5,
    1600: 5,
    1200: 4,
    900: 3,
    768: 2,
    640: 1,
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-10 pt-4 md:px-8">
      <div
        className={`sticky top-0 z-[1] mt-0 bg-white transition-transform duration-300 ${
          isSearchVisible ? 'translate-y-0' : '-translate-y-full'
        } py-2`}
      >
        <div className="mx-auto w-full px-4 md:px-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex w-full items-center justify-end gap-3 md:w-[480px] md:justify-start">
              <a
                href="/boost/create-v2"
                className="flex flex-shrink-0 items-center justify-center rounded-full bg-[#f0b90b] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:scale-110 hover:bg-[#f0b90b] hover:text-black"
              >
                Create Boost
              </a>
              {/* Filter dropdown */}
              <div ref={filterRef} className="relative">
                <button
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-2 text-sm font-medium transition-all ${
                    activeStatus !== 'all'
                      ? 'border-[#f0b90b] bg-[#f0b90b]/5 text-[#f0b90b]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <FunnelIcon className="h-4 w-4" />
                  <span>
                    {STATUS_OPTIONS.find((o) => o.value === activeStatus)?.label || 'All'}
                  </span>
                  <ChevronDownIcon className={`h-3 w-3 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
                </button>
                {isFilterOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setActiveStatus(opt.value);
                          setIsFilterOpen(false);
                        }}
                        className={`flex w-full items-center px-4 py-2 text-sm transition-colors ${
                          activeStatus === opt.value
                            ? 'bg-[#f0b90b]/10 font-medium text-[#f0b90b]'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex items-center md:flex-1 md:justify-end">
                <div className="hidden w-full md:block">
                  <div className="group relative w-full">
                    <div className="relative w-[70%] origin-left transition-all duration-300 ease-in-out group-focus-within:w-[100%] group-focus-within:-translate-y-0.5 group-focus-within:scale-[1.02] group-hover:-translate-y-0.5 group-hover:scale-[1.01] md:w-[60%] md:group-focus-within:w-[120%]">
                      <input
                        type="text"
                        className="block w-full rounded-full border-0 py-2.5 pl-6 pr-12 text-gray-500 shadow-sm ring-1 ring-inset ring-gray-200 transition-all duration-300 ease-in-out placeholder:text-gray-400 focus:shadow-lg focus:ring-2 focus:ring-inset focus:ring-[#F0B90B] sm:text-base md:py-2"
                        placeholder="Search"
                        onFocus={(e) =>
                          (e.target.placeholder = 'Search by author or keyword')
                        }
                        onBlur={(e) => (e.target.placeholder = 'Search')}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        value={searchQuery}
                      />
                      <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                        <MagnifyingGlassIcon className="h-5 w-5 text-[#F0B90B]" />
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  ref={mobileSearchButtonRef}
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors duration-200 hover:border-[#F0B90B] hover:text-[#F0B90B] md:hidden"
                  onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
                  aria-label="搜索"
                >
                  <MagnifyingGlassIcon className="h-5 w-5" />
                </button>
                {isMobileSearchOpen && (
                  <div className="pointer-events-none fixed inset-x-0 top-[64px] z-30 flex justify-center px-5 md:hidden">
                    <div
                      ref={mobileSearchContainerRef}
                      className="pointer-events-auto w-full max-w-sm rounded-full border border-[#F0B90B] bg-white px-2.5 py-0 shadow-md shadow-black/10"
                    >
                      <div className="flex items-center gap-2">
                        <MagnifyingGlassIcon className="h-4 w-4 text-[#F0B90B]" />
                        <input
                          ref={mobileSearchInputRef}
                          type="text"
                          className="flex-1 rounded-full border border-transparent bg-transparent px-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-0"
                          placeholder="Search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <button
                          type="button"
                          className="rounded-full bg-[#F0B90B] px-3 py-1 text-xs font-medium text-white shadow hover:bg-[#e6a800] active:scale-95"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setIsMobileSearchOpen(false)}
                        >
                          Enter
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Right side: Auth & Wallet */}
            <div className="flex items-center gap-3">
              <WalletConnect btnClassName="!px-5 !py-2 !text-sm !rounded-full !min-h-0 !h-auto" />
              {isAuthLoading ? (
                <div className="h-9 w-20 animate-pulse rounded-full bg-gray-100" />
              ) : user ? (
                <ProfileButton
                  userData={user}
                  onSignOut={logout}
                  showUserInfo={false}
                  size="small"
                  menuDirection="bottom"
                />
              ) : (
                <button
                  onClick={() => setIsLoginModalOpen(true)}
                  className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-2 md:pt-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[...Array(10)].map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="card w-full bg-base-100 shadow-md"
              >
                <div className="card-body rounded-2xl border-[1px] border-t border-gray-100 p-3">
                  <div className="mt-1 flex items-center gap-5">
                    <div className="w-full">
                      <div className="skeleton h-4 w-full rounded border-gray-100"></div>
                      <div className="skeleton mt-2 h-4 w-full rounded border-gray-100"></div>
                    </div>
                  </div>
                  <div className="skeleton mt-1 flex h-48 w-48 items-start justify-start overflow-hidden rounded-2xl border-gray-100"></div>
                  <div className="mb-1 mt-2 space-y-2">
                    <div className="skeleton mb-3 h-6 w-full rounded border-gray-100"></div>
                    <div className="skeleton h-4 w-4/5 rounded border-gray-100"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="col-span-full py-10 text-center">
            <p className="text-red-500">{error}</p>
          </div>
        ) : boosts.length === 0 ? (
          <div className="col-span-full py-10 text-center">
            <p className="text-gray-500">No boosts found.</p>
          </div>
        ) : (
          <Masonry
            breakpointCols={breakpointColumnsObj}
            className="-ml-2 flex w-auto sm:-ml-4"
            columnClassName="pl-2 sm:pl-4 bg-clip-padding"
          >
            {boosts.map((boost) => (
              <div
                key={boost.id}
                className="mb-3 card !z-0 cursor-pointer bg-base-100 shadow-sm will-change-transform backface-visibility-hidden transform-gpu transition-all duration-150 ease-out hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(240,_185,_11,_0.25)] sm:mb-4"
              >
                <AssetCard boost={boost} />
              </div>
            ))}
          </Masonry>
        )}
      </div>

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}
