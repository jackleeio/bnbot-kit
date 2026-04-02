'use client';

import { useEffect, useState, useRef } from 'react';
import { useNotification } from '@/context/notification-context';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  type BaseError,
} from 'wagmi';
import { parseUnits } from 'viem';
import {
  boostVaultAbi,
  erc20Abi,
  BOOST_VAULT_ADDRESS,
  USDC_ADDRESS,
  NATIVE_TOKEN_ADDRESS,
} from '@/contracts/BoostVault';
import {
  fetchTweetInfo,
  createBoost,
  getBoostSignature,
  createBoostCheckout,
  type TweetInfo,
  type BoostSignatureResponse,
} from '@/lib/boost-api';

function extractTweetId(url: string): string | null {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

type PaymentMethod = 'crypto' | 'stripe';
type TokenType = 'USDC' | 'BNB';

const DURATION_OPTIONS = [
  { label: '3 Days', value: 3 },
  { label: '5 Days', value: 5 },
  { label: '7 Days', value: 7 },
  { label: '14 Days', value: 14 },
];

export default function CreateBoostV2() {
  const { showNotification } = useNotification();
  const { address, isConnected } = useAccount();
  const router = useRouter();

  // Step state
  const [currentStep, setCurrentStep] = useState(0);

  // Tweet
  const [tweetUrl, setTweetUrl] = useState('');
  const [tweetInfo, setTweetInfo] = useState<TweetInfo | null>(null);
  const [isFetchingTweet, setIsFetchingTweet] = useState(false);
  const fetchedTweetIdRef = useRef<string | null>(null);

  // Config
  const [tokenType, setTokenType] = useState<TokenType>('USDC');
  const [budget, setBudget] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  const [quoterPct, setQuoterPct] = useState(50);
  const [retweeterPct, setRetweeterPct] = useState(30);
  const [replierPct, setReplierPct] = useState(20);
  const BSC_TESTNET_CHAIN_ID = 97;

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('crypto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStep, setTxStep] = useState('');

  // Contract interaction
  const {
    data: approveHash,
    writeContract: writeApprove,
    status: approveStatus,
    error: approveError,
  } = useWriteContract();

  const {
    data: createBoostHash,
    writeContract: writeCreateBoost,
    status: createBoostStatus,
    error: createBoostError,
  } = useWriteContract();

  const { isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const { isSuccess: isCreateBoostConfirmed } = useWaitForTransactionReceipt({
    hash: createBoostHash,
  });

  // Async fetch tweet info in background when URL changes
  useEffect(() => {
    const id = extractTweetId(tweetUrl);
    if (!id || id === fetchedTweetIdRef.current) return;
    setIsFetchingTweet(true);
    setTweetInfo(null);
    let cancelled = false;
    fetchTweetInfo(id)
      .then((info) => {
        if (cancelled) return;
        fetchedTweetIdRef.current = id;
        setTweetInfo(info);
      })
      .catch(() => {
        // silently fail
      })
      .finally(() => {
        if (!cancelled) setIsFetchingTweet(false);
      });
    return () => { cancelled = true; };
  }, [tweetUrl]);

  // Handle contract errors
  useEffect(() => {
    if (approveStatus === 'error' && approveError) {
      const msg = (approveError as BaseError)?.shortMessage ?? 'Approve failed';
      showNotification({ msg, type: 'error', title: 'Approve Failed' });
      setIsSubmitting(false);
      setTxStep('');
    }
  }, [approveStatus, approveError, showNotification]);

  useEffect(() => {
    if (createBoostStatus === 'error' && createBoostError) {
      const msg =
        (createBoostError as BaseError)?.shortMessage ?? 'Transaction failed';
      showNotification({ msg, type: 'error', title: 'Transaction Failed' });
      setIsSubmitting(false);
      setTxStep('');
    }
  }, [createBoostStatus, createBoostError, showNotification]);

  // After createBoost confirmed
  useEffect(() => {
    if (isCreateBoostConfirmed) {
      setIsSubmitting(false);
      setTxStep('');
      showNotification({
        msg: 'Boost created! It will be activated shortly.',
        type: 'success',
        title: 'Boost Created',
      });
      setCurrentStep(2);
    }
  }, [isCreateBoostConfirmed, showNotification]);

  // Store signature for approve->createBoost flow
  const pendingSignatureRef = useRef<BoostSignatureResponse | null>(null);

  // After approve confirmed, proceed with createBoost
  useEffect(() => {
    if (isApproveConfirmed && pendingSignatureRef.current) {
      setTxStep('Creating boost on-chain...');
      const sig = pendingSignatureRef.current;
      writeCreateBoost({
        address: BOOST_VAULT_ADDRESS,
        abi: boostVaultAbi,
        functionName: 'createBoost',
        args: [
          sig.boost_id_bytes32 as `0x${string}`,
          sig.token as `0x${string}`,
          BigInt(sig.amount),
          BigInt(sig.end_time),
          BigInt(sig.deadline),
          sig.signature as `0x${string}`,
        ],
      });
      pendingSignatureRef.current = null;
    }
  }, [isApproveConfirmed, writeCreateBoost]);

  const tweetId = extractTweetId(tweetUrl);
  const tokenDecimals = tokenType === 'USDC' ? 6 : 18;

  // Submit handler
  const handleSubmit = async () => {
    if (!tweetId || !budget || parseFloat(budget) <= 0) return;
    setIsSubmitting(true);

    try {
      // 1. Create boost on backend
      setTxStep('Creating boost...');
      const budgetWei = parseUnits(budget, tokenDecimals).toString();
      const boost = await createBoost({
        tweet_id: tweetId,
        tweet_author: tweetInfo?.author.screen_name || '',
        tweet_content: tweetInfo?.text || '',
        tweet_snapshot: tweetInfo ? (tweetInfo as unknown as Record<string, unknown>) : {},
        total_budget: budgetWei,
        token_type: tokenType === 'USDC' ? 'ERC20' : 'NATIVE',
        token_symbol: tokenType,
        token_address: tokenType === 'USDC' ? USDC_ADDRESS : undefined,
        chain_id: BSC_TESTNET_CHAIN_ID,
        quoter_pool_percentage: quoterPct / 100,
        retweeter_pool_percentage: retweeterPct / 100,
        replier_pool_percentage: replierPct / 100,
        duration_days: durationDays,
      });

      if (paymentMethod === 'stripe') {
        // Stripe flow
        setTxStep('Redirecting to payment...');
        const { checkout_url } = await createBoostCheckout(boost.id, parseFloat(budget));
        window.location.href = checkout_url;
        return;
      }

      // Crypto flow
      if (!isConnected || !address) {
        showNotification({
          msg: 'Please connect your wallet first.',
          type: 'error',
          title: 'Wallet Required',
        });
        setIsSubmitting(false);
        setTxStep('');
        return;
      }

      // 2. Get signature
      setTxStep('Getting signature...');
      const signature = await getBoostSignature(boost.id);

      // 3. ERC20: approve first
      if (tokenType === 'USDC') {
        setTxStep('Approving USDC...');
        pendingSignatureRef.current = signature;
        writeApprove({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [BOOST_VAULT_ADDRESS, BigInt(signature.amount)],
        });
      } else {
        // Native token: direct createBoost with value
        setTxStep('Creating boost on-chain...');
        writeCreateBoost({
          address: BOOST_VAULT_ADDRESS,
          abi: boostVaultAbi,
          functionName: 'createBoost',
          args: [
            signature.boost_id_bytes32 as `0x${string}`,
            signature.token as `0x${string}`,
            BigInt(signature.amount),
            BigInt(signature.end_time),
            BigInt(signature.deadline),
            signature.signature as `0x${string}`,
          ],
          value: BigInt(signature.amount),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      showNotification({ msg, type: 'error', title: 'Error' });
      setIsSubmitting(false);
      setTxStep('');
    }
  };

  const steps = ['Configure', 'Pay'];
  const hasTweetId = !!tweetId;
  const canProceedToPayment = hasTweetId && budget && parseFloat(budget) > 0;

  // Helper: adjust 3-pool percentages so they always sum to 100
  const adjustPools = (
    key: 'quoter' | 'retweeter' | 'replier',
    value: number,
  ) => {
    if (key === 'quoter') {
      const remaining = 100 - value;
      const ratio = retweeterPct + replierPct === 0 ? 0.5 : retweeterPct / (retweeterPct + replierPct);
      setQuoterPct(value);
      setRetweeterPct(Math.round(remaining * ratio));
      setReplierPct(remaining - Math.round(remaining * ratio));
    } else if (key === 'retweeter') {
      const remaining = 100 - value;
      const ratio = quoterPct + replierPct === 0 ? 0.5 : quoterPct / (quoterPct + replierPct);
      setRetweeterPct(value);
      setQuoterPct(Math.round(remaining * ratio));
      setReplierPct(remaining - Math.round(remaining * ratio));
    } else {
      const remaining = 100 - value;
      const ratio = quoterPct + retweeterPct === 0 ? 0.5 : quoterPct / (quoterPct + retweeterPct);
      setReplierPct(value);
      setQuoterPct(Math.round(remaining * ratio));
      setRetweeterPct(remaining - Math.round(remaining * ratio));
    }
  };

  // Tweet card component for right panel
  const TweetCard = () => {
    if (!hasTweetId) return null;

    if (isFetchingTweet) {
      return (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3 animate-pulse">
            <div className="h-10 w-10 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-gray-200" />
              <div className="h-3 w-full rounded bg-gray-200" />
              <div className="h-3 w-3/4 rounded bg-gray-200" />
            </div>
          </div>
        </div>
      );
    }

    if (!tweetInfo) {
      return (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-center text-sm text-gray-400">
          Tweet preview unavailable
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <img
            src={tweetInfo.author.image}
            alt={tweetInfo.author.name}
            className="h-10 w-10 rounded-full"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-900 truncate text-sm">
                {tweetInfo.author.name}
              </span>
              {tweetInfo.author.blue_verified && (
                <svg className="h-4 w-4 flex-shrink-0 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                </svg>
              )}
              <span className="text-xs text-gray-500">
                @{tweetInfo.author.screen_name}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-700 leading-relaxed">
              {tweetInfo.text}
            </p>
            {tweetInfo.media?.images && tweetInfo.media.images.length > 0 && (
              <img
                src={tweetInfo.media.images[0].media_url_https}
                alt=""
                className="mt-3 w-full rounded-xl object-cover"
              />
            )}
            <div className="mt-3 flex gap-4 text-xs text-gray-400">
              <span>{tweetInfo.likes.toLocaleString()} likes</span>
              <span>{tweetInfo.retweets.toLocaleString()} retweets</span>
              <span>{tweetInfo.quotes.toLocaleString()} quotes</span>
              <span>{tweetInfo.views_count.toLocaleString()} views</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="mx-auto w-full max-w-[1100px] px-4 pb-20 pt-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => {
              if (currentStep === 1) {
                setCurrentStep(0);
              } else {
                router.push('/boost');
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-all hover:border-gray-300 hover:text-gray-900 hover:shadow-sm"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Create Boost</h1>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* Left: Form */}
          <div className="flex-1 min-w-0">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              {/* Step Indicator */}
              {currentStep < 2 && (
                <div className="mb-8 flex items-center justify-center gap-1">
                  {steps.map((label, i) => (
                    <div key={label} className="flex items-center">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                          i <= currentStep
                            ? 'bg-[#f0b90b] text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {i < currentStep ? (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </div>
                      <span
                        className={`ml-1 hidden text-xs sm:inline ${
                          i <= currentStep ? 'text-[#f0b90b] font-medium' : 'text-gray-400'
                        }`}
                      >
                        {label}
                      </span>
                      {i < steps.length - 1 && (
                        <div
                          className={`mx-2 h-[2px] w-8 sm:w-12 ${
                            i < currentStep ? 'bg-[#f0b90b]' : 'bg-gray-200'
                          }`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Success State */}
              {currentStep === 2 && (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-green-800">Boost Created Successfully!</h2>
                  <p className="mt-2 text-green-600">
                    Your boost will be activated once the transaction is confirmed on-chain.
                  </p>
                  <a
                    href="/boost"
                    className="mt-6 inline-block rounded-full bg-[#f0b90b] px-6 py-2.5 text-sm font-medium text-white transition-all hover:scale-105 hover:bg-[#e6af0a]"
                  >
                    View All Boosts
                  </a>
                </div>
              )}

              {/* Step 1: Configure */}
              {currentStep === 0 && (
                <>
                  <input
                    type="url"
                    placeholder="Paste tweet link (x.com or twitter.com)"
                    className="w-full rounded-full border-2 border-gray-200 px-5 py-3.5 text-center text-gray-900 transition-all placeholder:text-gray-400 focus:border-[#f0b90b] focus:outline-none focus:ring-0"
                    value={tweetUrl}
                    onChange={(e) => setTweetUrl(e.target.value)}
                  />

                  {hasTweetId && (
                    <div className="mt-6 space-y-5">
                      {/* Token Selection */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Token</label>
                        <div className="flex gap-3">
                          {(['USDC', 'BNB'] as TokenType[]).map((t) => (
                            <button
                              key={t}
                              onClick={() => setTokenType(t)}
                              className={`flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all ${
                                tokenType === t
                                  ? 'border-[#f0b90b] bg-[#f0b90b]/5 text-[#f0b90b]'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Budget */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Total Budget</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Enter amount"
                            className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 pr-16 text-gray-900 transition-all placeholder:text-gray-400 focus:border-[#f0b90b] focus:outline-none focus:ring-0"
                            value={budget}
                            onChange={(e) => setBudget(e.target.value)}
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                            {tokenType}
                          </span>
                        </div>
                      </div>

                      {/* Duration */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Duration</label>
                        <div className="flex gap-3">
                          {DURATION_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => setDurationDays(opt.value)}
                              className={`flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all ${
                                durationDays === opt.value
                                  ? 'border-[#f0b90b] bg-[#f0b90b]/5 text-[#f0b90b]'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 3-Pool Distribution */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Reward Distribution</label>
                        <div className="rounded-xl border-2 border-gray-200 p-4 space-y-4">
                          {/* Quoters */}
                          <div>
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                              <span>Quoters</span>
                              <strong className="text-[#f0b90b]">{quoterPct}%</strong>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={quoterPct}
                              onChange={(e) => adjustPools('quoter', Number(e.target.value))}
                              className="range range-warning range-xs w-full"
                            />
                          </div>
                          {/* Retweeters */}
                          <div>
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                              <span>Retweeters</span>
                              <strong className="text-[#f0b90b]">{retweeterPct}%</strong>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={retweeterPct}
                              onChange={(e) => adjustPools('retweeter', Number(e.target.value))}
                              className="range range-warning range-xs w-full"
                            />
                          </div>
                          {/* Repliers */}
                          <div>
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                              <span>Repliers</span>
                              <strong className="text-[#f0b90b]">{replierPct}%</strong>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={replierPct}
                              onChange={(e) => adjustPools('replier', Number(e.target.value))}
                              className="range range-warning range-xs w-full"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Next Button */}
                      <button
                        onClick={() => setCurrentStep(1)}
                        disabled={!canProceedToPayment}
                        className="w-full rounded-full bg-[#f0b90b] px-4 py-3.5 text-base font-medium text-white transition-all hover:scale-[1.02] hover:bg-[#e6af0a] hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Step 2: Pay */}
              {currentStep === 1 && (
                <div className="space-y-5">
                  {/* Payment Method */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Payment Method</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setPaymentMethod('crypto')}
                        className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-4 transition-all ${
                          paymentMethod === 'crypto'
                            ? 'border-[#f0b90b] bg-[#f0b90b]/5'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <svg className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3" />
                        </svg>
                        <span className="text-sm font-medium text-gray-700">Crypto Wallet</span>
                        <span className="text-xs text-gray-400">Pay with {tokenType}</span>
                      </button>
                      <button
                        onClick={() => setPaymentMethod('stripe')}
                        className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-4 transition-all ${
                          paymentMethod === 'stripe'
                            ? 'border-[#f0b90b] bg-[#f0b90b]/5'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <svg className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                        </svg>
                        <span className="text-sm font-medium text-gray-700">Bank Card</span>
                        <span className="text-xs text-gray-400">Visa / Mastercard</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <h3 className="mb-3 text-sm font-medium text-gray-700">Summary</h3>
                    <div className="space-y-1.5 text-sm text-gray-600">
                      <div className="flex justify-between">
                        <span>Tweet</span>
                        <span className="text-gray-900">
                          {tweetInfo ? `@${tweetInfo.author.screen_name}` : tweetId}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Budget</span>
                        <span className="text-gray-900">{budget} {tokenType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Duration</span>
                        <span className="text-gray-900">{durationDays} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Distribution</span>
                        <span className="text-gray-900">
                          Q {quoterPct}% / RT {retweeterPct}% / Reply {replierPct}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Payment</span>
                        <span className="text-gray-900">
                          {paymentMethod === 'crypto' ? 'Crypto Wallet' : 'Bank Card'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {paymentMethod === 'crypto' && !isConnected && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-700">
                      Please connect your wallet to continue
                    </div>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={
                      isSubmitting ||
                      (paymentMethod === 'crypto' && !isConnected)
                    }
                    className="w-full rounded-full bg-[#f0b90b] px-4 py-3.5 text-base font-medium text-white transition-all hover:scale-[1.02] hover:bg-[#e6af0a] hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="loading loading-spinner loading-sm" />
                        {txStep}
                      </span>
                    ) : paymentMethod === 'stripe' ? (
                      `Pay $${budget} with Card`
                    ) : (
                      `Pay ${budget} ${tokenType}`
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Tweet Preview (desktop only) */}
          {hasTweetId && currentStep < 2 && (
            <div className="hidden w-[340px] flex-shrink-0 lg:block">
              <div className="sticky top-24">
                <TweetCard />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
