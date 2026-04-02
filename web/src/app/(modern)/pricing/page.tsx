'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import Pricing from '@/components/homepage/Pricing';

export default function PricingPage() {
  const router = useRouter();

  const handleClose = () => {
    router.push('/credits');
  };

  return (
    <div className="min-h-screen bg-white relative">
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 z-50 p-2 rounded-full hover:bg-gray-100 transition-colors"
        aria-label="Close"
      >
        <X className="w-5 h-5 text-gray-500 hover:text-gray-700" />
      </button>

      <Pricing />
    </div>
  );
}
