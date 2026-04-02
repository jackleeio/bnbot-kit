'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { getPlanDisplayName, PlanType } from '@/data/utils/stripe';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Loader2, ArrowRight, Sparkles, AlertCircle } from 'lucide-react';
import { StripeService, SubscriptionStatusResponse } from '@/data/utils/stripe';

function SubscriptionSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] = useState<SubscriptionStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');

    const fetchSubscriptionStatus = async () => {
      try {
        setIsLoading(true);
        // Wait a moment for webhook to process
        await new Promise(resolve => setTimeout(resolve, 2000));

        const data = await StripeService.getSubscriptionStatus();
        setSubscription(data);
      } catch (err: any) {
        console.error('Failed to fetch subscription status:', err);
        setError('Unable to verify subscription. Please check your account settings.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSubscriptionStatus();
  }, [searchParams]);

  const handleGoToAgent = () => {
    router.push('/agent');
  };

  const handleGoToSettings = () => {
    router.push('/credits');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-gold-500 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Verifying Subscription</h2>
          <p className="text-slate-500">Checking your account status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-lg p-8 text-center border border-slate-100">
          <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">
            Status Check
          </h1>
          <p className="text-slate-500 mb-8">
            {error}
          </p>
          <button
            onClick={handleGoToSettings}
            className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-semibold hover:bg-slate-800 transition-colors"
          >
            Go to Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-purple-200/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-gold-200/30 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 md:p-10 text-center relative z-10 animate-fade-in border border-slate-100">
        {/* Success Icon */}
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6 relative">
          <div className="absolute inset-0 bg-green-100 rounded-full animate-ping-slow opacity-50" />
          <CheckCircle className="w-12 h-12 text-green-500 relative z-10" />
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-slate-900 mb-3 font-display">
          Subscription Active!
        </h1>

        <p className="text-slate-500 mb-8 leading-relaxed">
          Your subscription is confirmed and credits have been added. You are ready to create!
        </p>

        {/* Subscription Details */}
        {subscription?.subscription && (
          <div className="bg-slate-50 rounded-2xl p-6 mb-8 text-left border border-slate-100">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-200/60">
              <span className="text-sm text-slate-500 font-medium">Current Plan</span>
              <span className="text-base font-bold text-slate-900 bg-white px-3 py-1 rounded-full shadow-sm border border-slate-100">
                {getPlanDisplayName(subscription.subscription.plan_name as PlanType)}
              </span>
            </div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-slate-500 font-medium">Billing Cycle</span>
              <span className="text-sm font-semibold text-slate-900 capitalize">
                {subscription.subscription.billing_interval}ly
              </span>
            </div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-slate-500 font-medium">Credits</span>
              <span className="text-sm font-bold text-gold-600 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                {subscription.subscription.credits_per_period.toLocaleString()} / month
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500 font-medium">Next Renewal</span>
              <span className="text-sm font-semibold text-slate-700">
                {new Date(subscription.subscription.current_period_end).toLocaleDateString()}
              </span>
            </div>
          </div>
        )}

        {/* CTA Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleGoToAgent}
            className="w-full bg-slate-900 text-white py-4 rounded-xl font-semibold hover:bg-slate-800 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-slate-900/10 flex items-center justify-center gap-2"
          >
            Start Creating
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoToSettings}
            className="w-full bg-white text-slate-600 border border-slate-200 py-4 rounded-xl font-medium hover:bg-slate-50 transition-colors hover:text-slate-900"
          >
            Manage Subscription
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-gold-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <SubscriptionSuccessContent />
    </Suspense>
  );
}
