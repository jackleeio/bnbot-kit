'use client';

import Image from '@/components/ui/image';
import EthBrand from '@/assets/images/eth-brand-9.avif';
import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import cn from '@/utils/cn';
import ethLogo from '@/assets/images/logo-eth-purple.png';
import xLogo from '@/assets/images/logo-x-black.png';
import { useChainId, useSendTransaction, type BaseError } from 'wagmi';
import { parseEther } from 'viem';
import { RadioGroup } from '@/components/ui/radio-group';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import Assistant from '@/components/task/assistant';
import Reviewer from '@/components/task/reviewer';

interface StatusProps {
  status: 'assistant' | 'reviewer';
  setStatus: React.Dispatch<React.SetStateAction<'assistant' | 'reviewer'>>;
}

function Status({ status, setStatus }: StatusProps) {
  return (
    <RadioGroup
      value={status}
      onChange={setStatus}
      className="mx-auto flex w-fit items-center justify-center rounded-3xl bg-slate-100/50 p-1 sm:gap-0"
    >
      <RadioGroup.Option value="assistant">
        {({ checked }) => (
          <span
            className={`relative flex h-12 w-28 cursor-pointer items-center justify-center rounded-3xl text-center text-xs font-medium tracking-wider sm:w-36 sm:text-sm ${
              checked ? 'text-white' : 'text-[#f0b90b] dark:text-white/50'
            }`}
          >
            {checked && (
              <motion.span
                className="absolute bottom-0 left-0 right-0 h-full w-full rounded-3xl bg-[#f0b90b] shadow-large"
                layoutId="statusIndicator"
              />
            )}
            <span className="relative">Assistant</span>
          </span>
        )}
      </RadioGroup.Option>
      <RadioGroup.Option value="reviewer">
        {({ checked }) => (
          <span
            className={`relative flex h-12 w-28 cursor-pointer items-center justify-center rounded-3xl text-center text-xs font-medium tracking-wider sm:w-36 sm:text-sm ${
              checked ? 'text-white' : 'text-[#f0b90b] dark:text-white/50'
            }`}
          >
            {checked && (
              <motion.span
                className="absolute bottom-0 left-0 right-0 h-full w-full rounded-3xl bg-[#f0b90b] shadow-large"
                layoutId="statusIndicator"
              />
            )}
            <span className="relative">Boost</span>
          </span>
        )}
      </RadioGroup.Option>
    </RadioGroup>
  );
}

function CreateRobotPageContent() {
  const searchParams = useSearchParams();
  const typeParam = searchParams.get('type');
  
  const [botType, setBotType] = useState<'assistant' | 'reviewer'>(
    typeParam === 'boost' ? 'reviewer' : 'assistant'
  );

  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    console.log('Current botType:', botType);
  }, [botType]);

  return (
    <>
      <div className="m-auto mt-8 w-full px-4 text-center sm:px-6 md:w-1/2 lg:px-8 3xl:px-10">
        <div className="mx-auto flex w-full flex-col md:w-5/6 xl:px-6 3xl:max-w-[1700px] 3xl:px-12">
          <h5 className="m-auto mb-2 mt-3 w-full pt-1 text-center text-md">
            Custom Tasks for <span className="text-[#f0b90b]">BNBOT</span>
          </h5>
          <Status status={botType} setStatus={setBotType} />

          {isLoaded && (
            <div className="mt-8 w-full">
              {botType === 'assistant' ? <Assistant /> : <Reviewer />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function CreateRobotPage() {
  return (
    <Suspense fallback={null}>
      <CreateRobotPageContent />
    </Suspense>
  );
}
