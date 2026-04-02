'use client';

import AnchorLink from '@/components/ui/links/anchor-link';
import { useIsMounted } from '@/lib/hooks/use-is-mounted';
import { useLayout } from '@/lib/hooks/use-layout';
import cn from '@/utils/cn';

interface LogoPropTypes {
  className?: string;
}

export default function Logo({ className }: LogoPropTypes) {
  const { layout } = useLayout();
  const isMounted = useIsMounted();
  return (
    isMounted && (
      <AnchorLink
        href="https://bnbot.ai"
        className={cn('flex w-48 items-center outline-none sm:w-48', className)}
      >
        <span className="relative flex items-end overflow-hidden">
          <span className="rounded-md bg-gray-100/50 px-1.5 py-0.5 text-[10px] font-semibold text-[#f0b90b]">
            v0.3
          </span>
        </span>
      </AnchorLink>
    )
  );
}
