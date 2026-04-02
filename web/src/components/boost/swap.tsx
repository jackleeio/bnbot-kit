import { useState } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import ethLogo from '@/assets/images/logo-eth-color.png';

interface SwapProps {
  // 可以根据需要添加更多props
  defaultAmount?: string;
  onSwap?: (amount: string, isBuying: boolean) => void;
}

interface TokenPrice {
  ETH: number;
  name: string;
  symbol: string;
  decimals: number;
}

export const TOKEN_PRICE: TokenPrice = {
  ETH: 0.00000015, // 每个token的ETH价格
  name: 'Starbase',
  symbol: 'Starbase',
  decimals: 18,
};

export default function Swap({ defaultAmount = '', onSwap }: SwapProps) {
  const [isBuying, setIsBuying] = useState(true);
  const [inputAmount, setInputAmount] = useState(defaultAmount);

  const handleSwap = () => {
    onSwap?.(inputAmount, isBuying);
  };

  return (
    <div className="w-full rounded-2xl bg-white p-4 shadow-card dark:bg-light-dark xl:max-w-[358px]">
      <div className="mb-5">
        <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">
          Swap
        </h3>
        <div className="grid w-full grid-cols-2 gap-4">
          <button
            onClick={() => setIsBuying(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              isBuying
                ? 'bg-brand text-white'
                : 'bg-gray-100/80 text-gray-900 hover:bg-gray-200/80'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setIsBuying(false)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              !isBuying
                ? 'bg-red-500 text-white'
                : 'bg-gray-100/80 text-gray-900 hover:bg-gray-200/80'
            }`}
          >
            Sell
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <input
              type="text"
              name="search"
              id="search"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              className="block w-full rounded-xl border-0 py-2.5 pr-20 text-left text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6"
              placeholder="0.00"
            />
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <span className="text-gray-500 sm:text-xs">ETH</span>
              <span className="relative ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100">
                <img
                  src={ethLogo.src}
                  alt="Logo"
                  className="h-full w-full rounded-full object-cover"
                />
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              {[0.0001, 0.001, 0.01].map((amount) => (
                <button
                  key={amount}
                  onClick={() => setInputAmount(amount.toString())}
                  className="rounded-lg bg-gray-100 px-1.5 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-200"
                >
                  {amount} <span className="text-xs">ETH</span>
                </button>
              ))}
            </div>
            {inputAmount && (
              <div className="text-xs text-gray-500">
                ≈ {`${(Number(inputAmount) / TOKEN_PRICE.ETH).toLocaleString('en-US', {
                  maximumFractionDigits: 0
                })} ${TOKEN_PRICE.symbol}`}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Trading Fee</span>
          <span className="flex items-center gap-1">
            <InformationCircleIcon className="h-4 w-4" />
            0.3%
          </span>
        </div>

        <button
          onClick={handleSwap}
          className="w-full rounded-3xl bg-black py-3 text-white transition-colors"
        >
          Place Trade
        </button>
      </div>
    </div>
  );
}
