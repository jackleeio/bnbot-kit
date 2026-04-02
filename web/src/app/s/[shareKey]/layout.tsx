import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Tweet Schedule - BNBot',
  description: 'View scheduled tweets and publishing calendar',
};

export default function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Minimal header with logo only */}
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <Image
            src="/icons/bnbot-new-logo-sm.png"
            alt="BNBot"
            width={24}
            height={24}
            className="rounded"
          />
          <span className="text-sm font-semibold text-gray-900">BNBot</span>
          <span className="text-xs text-gray-400">Schedule</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
