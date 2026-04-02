'use client';

import { useEffect, useState, type ReactNode, use } from 'react';
import BoostDetailPageView from '@/components/boost/boost-detail-page-view';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { getBoostDetail, type BoostPublic } from '@/lib/boost-api';

export default function BoostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [boost, setBoost] = useState<BoostPublic | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const HEADER_HEIGHT = 44;

  // Handle Stripe callback status
  const paymentStatus = searchParams.get('status');

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      try {
        const data = await getBoostDetail(id);
        if (!cancelled) {
          setBoost(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[Boost] Error loading boost detail:', err);
          setError('Failed to load Boost details');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const renderShell = (content: ReactNode) => (
    <div className="flex h-full min-h-screen flex-col bg-white">
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-white/75 px-3 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center justify-center rounded-full p-1.5 text-black transition hover:bg-gray-100"
            onClick={() => router.back()}
            aria-label="返回"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold text-gray-900">Boost</h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
          <span className="relative flex h-3 w-3 flex-shrink-0 items-center justify-center">
            <span className="absolute h-3 w-3 rounded-full bg-[#f0b90b]/20" />
            <span className="blink relative block h-1.5 w-1.5 rounded-full bg-[#f0b90b]" />
          </span>
          <span className="text-xs text-gray-600">AI Monitoring</span>
        </div>
      </header>
      <main
        className="flex-1 overflow-y-auto bg-white"
        style={{ paddingTop: `${HEADER_HEIGHT - 4}px` }}
      >
        <div className="flex h-full items-center justify-center px-4 text-sm text-gray-500">
          {content}
        </div>
      </main>
    </div>
  );

  if (isLoading) return renderShell('Loading...');

  if (error || !boost) {
    return renderShell(
      <div className="flex flex-col items-center gap-4 text-center text-sm text-gray-600">
        <p>{error ?? 'Boost not found'}</p>
        <button
          type="button"
          className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
          onClick={() => router.back()}
        >
          Go Back
        </button>
      </div>,
    );
  }

  return (
    <BoostDetailPageView
      boost={boost}
      paymentStatus={paymentStatus}
      onBack={() => router.back()}
    />
  );
}
