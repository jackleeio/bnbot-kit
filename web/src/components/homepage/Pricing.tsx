'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useHomeTranslations } from '@/context/locale-context';
import LoginModal from '@/components/login/login-modal';
import SimpleNotify from '@/components/notification/simple-notify';
import { PlanType, BillingInterval, StripeService } from '@/data/utils/stripe';
import { useAuth } from '@/lib/hooks/useAuth';

interface PlanConfig {
  id: PlanType;
  translationKey: string;
  priceMonthly: number;
  priceYearly: number;
  originalPriceMonthly?: number;
  colorTheme: 'slate' | 'gold';
  featureCount: number;
  freeFeatureCount?: number;
  hasBadge?: boolean;
}

const planConfigs: PlanConfig[] = [
  {
    id: 'starter',
    translationKey: 'starter',
    priceMonthly: 0,
    priceYearly: 0,
    colorTheme: 'slate',
    featureCount: 3,
    freeFeatureCount: 5
  },
  {
    id: 'basic',
    translationKey: 'basic',
    priceMonthly: 24,
    priceYearly: 19,
    originalPriceMonthly: 32,
    colorTheme: 'gold',
    featureCount: 14,
    hasBadge: true
  },
  {
    id: 'pro',
    translationKey: 'pro',
    priceMonthly: 49,
    priceYearly: 39,
    originalPriceMonthly: 69,
    colorTheme: 'slate',
    featureCount: 4
  }
];

const Pricing: React.FC = () => {
  const { t } = useHomeTranslations('home.pricing');
  const { isLoggedIn } = useAuth();
  const [isAnnual, setIsAnnual] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PlanType | null>(null);
  const [isLoading, setIsLoading] = useState<PlanType | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [notification, setNotification] = useState({
    show: false,
    title: 'Coming Soon',
    msg: 'Ultimate plan is coming soon!',
    type: 'warning' as const,
  });
  const [currentPlan, setCurrentPlan] = useState<PlanType | null>(null);

  // Fetch subscription status
  useEffect(() => {
    if (!isLoggedIn) {
      setCurrentPlan(null);
      return;
    }
    StripeService.getSubscriptionStatus()
      .then((res) => {
        if (res.has_subscription && res.subscription?.status === 'active') {
          setCurrentPlan(res.subscription.plan_name);
        }
      })
      .catch(() => {});
  }, [isLoggedIn]);

  // Track scroll position to update active dot
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft;
      const cardWidth = container.scrollWidth / planConfigs.length;
      const index = Math.round(scrollLeft / cardWidth);
      setActiveIndex(Math.min(index, planConfigs.length - 1));
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to specific card when dot is clicked
  const scrollToCard = (index: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const cardWidth = container.scrollWidth / planConfigs.length;
    container.scrollTo({ left: cardWidth * index, behavior: 'smooth' });
  };

  const handleSubscribe = (planId: PlanType) => {
    // Check if user is logged in using useAuth hook
    if (!isLoggedIn) {
      // Store the pending plan and show login modal
      setPendingPlan(planId);
      setShowLoginModal(true);
      return;
    }

    // Redirect to Stripe checkout
    goToCheckout(planId);
  };

  const goToCheckout = async (planId: PlanType) => {
    const interval: BillingInterval = isAnnual ? 'year' : 'month';
    setIsLoading(planId);
    try {
      await StripeService.redirectToCheckout(planId, interval);
    } catch (error: any) {
      console.error('Failed to redirect to checkout:', error);
      const detail = error?.response?.data?.detail || error?.message || '';
      if (detail.includes('already have an active subscription')) {
        setNotification({ show: true, title: 'Already Subscribed', msg: 'You already have an active subscription. Please use the Customer Portal to manage it.', type: 'warning' });
      } else {
        setNotification({ show: true, title: 'Error', msg: detail || 'Failed to create checkout session', type: 'warning' });
      }
    } finally {
      // Reset loading state since checkout opens in new tab
      setIsLoading(null);
    }
  };

  // Handle button click - always go to checkout on homepage
  const handleButtonClick = (planId: PlanType) => {
    handleSubscribe(planId);
  };

  const handleLoginSuccess = () => {
    setShowLoginModal(false);
    // If there was a pending plan, go to checkout
    if (pendingPlan) {
      goToCheckout(pendingPlan);
      setPendingPlan(null);
    }
  };

  return (
    <section id="pricing" className="py-20 bg-white">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-5xl mx-auto mb-12">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-4 leading-tight tracking-wide">
            {t('title')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-600 to-yellow-500">{t('titleHighlight')}</span> {t('titleSuffix')}
          </h2>
          <p className="text-lg text-slate-500 mb-6">{t('subtitle')}</p>

          {/* Model Badges */}
          <p className="text-sm text-slate-400 mb-3">{t('poweredBy') || 'Powered by industry-leading models'}</p>
          <div className="flex items-center justify-center gap-4 sm:gap-6 mb-6 text-sm font-semibold text-slate-700">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" className="w-5 h-5"><defs><linearGradient id="gemini-g" x1="8" y1="8" x2="184" y2="184" gradientUnits="userSpaceOnUse"><stop stopColor="#4285F4"/><stop offset=".35" stopColor="#9B72CB"/><stop offset=".5" stopColor="#D96570"/><stop offset=".65" stopColor="#F0A358"/><stop offset="1" stopColor="#34A853"/></linearGradient></defs><path d="M164.93 86.68c-13.56-5.84-25.42-13.84-35.6-24.01-10.17-10.17-18.18-22.04-24.01-35.6-2.23-5.19-4.04-10.54-5.42-16.02C99.45 9.26 97.85 8 96 8s-3.45 1.26-3.9 3.05c-1.38 5.48-3.18 10.81-5.42 16.02-5.84 13.56-13.84 25.43-24.01 35.6-10.17 10.16-22.04 18.17-35.6 24.01-5.19 2.23-10.54 4.04-16.02 5.42C9.26 92.55 8 94.15 8 96s1.26 3.45 3.05 3.9c5.48 1.38 10.81 3.18 16.02 5.42 13.56 5.84 25.42 13.84 35.6 24.01 10.17 10.17 18.18 22.04 24.01 35.6 2.24 5.2 4.04 10.54 5.42 16.02A4.03 4.03 0 0 0 96 184c1.85 0 3.45-1.26 3.9-3.05 1.38-5.48 3.18-10.81 5.42-16.02 5.84-13.56 13.84-25.42 24.01-35.6 10.17-10.17 22.04-18.18 35.6-24.01 5.2-2.24 10.54-4.04 16.02-5.42A4.03 4.03 0 0 0 184 96c0-1.85-1.26-3.45-3.05-3.9-5.48-1.38-10.81-3.18-16.02-5.42" fill="url(#gemini-g)"/></svg>
              Gemini 3.1
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><g clipPath="url(#nb)"><path fill="#FFE6A9" d="M8.78 1.27c-.771 10.855 6.884 17.004 10.808 18.72 2.722 1.357.852 3.06-.295 3.135-13.571.89-18.2-11.664-15.168-18.637C6.551-1.091 8.94.299 8.78 1.269"/><path fill="#FFEDC2" d="M8.13 12.428c-.7-1.665-.628-7.826.285-11.8C8.513.2 7.498.31 6.955.58c-3.6 2.867-3.754 7.326-3.588 9.678s5.638 4.251 4.763 2.17"/><path fill="#F6C602" d="M1.533 18.867c.335.255 1.822-3.048 2.524-4.732.368-1.277.801-3.516-.403-2.253-1.506 1.579-2.539 6.667-2.12 6.985m6.63-5.799c1.134 6.553 11.314 9.616 12.642 9.115.516-.314.221-1.513-.241-1.728-5.87-3.182-8.49-6.317-8.698-8.52 3.355 3.32 6.278 1.035 5.262.314-1.59-1.129-3.38-4.7-5.148-4.198-2.962.84-4.22 2.69-3.817 5.017"/><path fill="#FFE6A9" d="M12.917 7.735c-1.479-.244-3.913 1.57-4.265 2.702 1.678-.61 1.926-.1 3.45 1.233 4.137 3.616 5.749.872 5.308.543-1.33-.994-3.604-4.331-4.493-4.478"/><path fill="#FFD425" d="M8.032 12.189c2.462 7.491 9.738 9.54 12.988 9.697-.202.548-.738 1.113-1.188 1.16-13.456 1.436-16.62-8.598-16.52-13.794 2.183-.615 4.056 1.701 4.72 2.936"/><path fill="#FFE6A9" d="M3.329 13.098c1.03-1.954 3.284-2.183 4.773-.837-1.184-2.414-2.223-3.012-2.7-3.147-6.285-1.785-5.02 7.547-4.454 9 .452 1.16.716.707.656.563-.357-.863.877-3.972 1.725-5.579"/></g><defs><clipPath id="nb"><rect width="24" height="24" fill="#fff"/></clipPath></defs></svg>
              Nano Banana 2
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33" className="w-5 h-5" fill="currentColor"><path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436"/><path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341"/></svg>
              Grok
            </span>
          </div>

          {/* Billing Toggle Tabs */}
          <div className="flex items-center justify-center select-none">
            <div className="inline-flex items-center bg-slate-100 rounded-full px-1 h-12">
              <button
                onClick={() => setIsAnnual(false)}
                className={`w-40 h-10 rounded-full text-sm font-semibold transition-all duration-300 cursor-pointer text-center ${!isAnnual ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t('monthly')}
              </button>
              <button
                onClick={() => setIsAnnual(true)}
                className={`w-40 h-10 rounded-full text-sm font-semibold transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 ${isAnnual ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t('yearly')}
                <span className="bg-gold-500 text-white text-[9px] font-bold px-2.5 py-0.5 rounded-full">{t('discount')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Cards Grid - 3 Columns */}
        <div className="md:grid md:grid-cols-3 gap-8 items-stretch md:overflow-visible relative">
          {/* Mobile Scroll Container */}
          <div
            ref={scrollContainerRef}
            className="flex items-stretch md:contents overflow-x-auto pb-8 md:pb-0 gap-4 snap-x snap-mandatory md:snap-none md:gap-8"
            style={{
              paddingInline: '6vw',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            {/* Hidden scrollbar for webkit browsers */}
            <style jsx>{`
              div::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <style jsx global>{`
              @keyframes goldBreathe {
                0%, 100% { box-shadow: 0 0 20px rgba(240,185,11,0.15); }
                50% { box-shadow: 0 0 60px rgba(240,185,11,0.6); }
              }
              .gold-breathe {
                animation: goldBreathe 3s ease-in-out infinite;
              }
            `}</style>
            {planConfigs.map((plan, index) => {
              const isGold = plan.colorTheme === 'gold';
              const isFirst = index === 0;
              const isLast = index === planConfigs.length - 1;
              const isCurrentPlan = currentPlan === plan.id;
              const badge = plan.hasBadge ? t(`plans.${plan.translationKey}.badge`) : null;

              return (
                <div
                  key={plan.id}
                  className={`
                    relative rounded-3xl p-6 sm:p-8 flex flex-col
                    flex-shrink-0 w-[88vw] md:w-auto md:max-w-none snap-center
                    md:snap-none
                    ${isCurrentPlan
                      ? 'bg-black shadow-[0_0_15px_rgba(0,0,0,0.08)] z-10'
                      : isGold
                        ? 'bg-black z-10 gold-breathe'
                        : 'bg-white shadow-md md:shadow-[0_8px_20px_rgba(0,0,0,0.08)]'
                    }
                  `}
                  style={{
                    scrollSnapStop: 'always'
                  }}
                >
                  {/* Badge */}
                  {badge && (
                    <div className="flex justify-end mb-2 -mt-1 gap-2">
                      <span className={`
                        px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full
                        ${isCurrentPlan ? 'bg-green-500 text-white' : isGold ? 'bg-gold-500 text-black' : 'bg-slate-200 text-slate-700'}
                      `}>
                        {badge}
                      </span>
                    </div>
                  )}

                  <h3 className={`text-lg font-semibold mb-1 ${isCurrentPlan || isGold ? 'text-white' : 'text-slate-900'} ${!badge ? 'mt-6' : ''}`}>
                    {t(`plans.${plan.translationKey}.name`)}
                  </h3>

                  <div className="flex items-baseline gap-1 mb-1 h-12">
                    {plan.originalPriceMonthly && isAnnual && (
                      <span className={`text-[2.1rem] font-bold line-through ${isCurrentPlan || isGold ? 'text-slate-600' : 'text-slate-300'}`}>
                        ${plan.priceMonthly}
                      </span>
                    )}
                    <span className={`text-4xl font-bold ${isCurrentPlan ? 'text-green-400' : isGold ? 'text-gold-400' : 'text-slate-900'}`}>
                      ${isAnnual ? plan.priceYearly : plan.priceMonthly}
                    </span>
                    {plan.priceMonthly > 0 && (
                      <span className={`text-xs ${isCurrentPlan || isGold ? 'text-slate-500' : 'text-slate-400'}`}>
                        /mo
                      </span>
                    )}
                  </div>

                  <div className="text-xs mb-4 invisible">placeholder</div>
                  {/* Credits Box */}
                  <div className={`rounded-xl py-3 px-4 mb-4 text-center text-sm font-bold ${isCurrentPlan ? 'bg-slate-800 text-green-400' : isGold ? 'bg-slate-800 text-gold-400' : 'bg-slate-50 text-slate-600'
                    }`}>
                    {t(`plans.${plan.translationKey}.credits`)}
                  </div>

                  <button
                    onClick={() => {
                      if (isCurrentPlan) return;
                      if (plan.priceMonthly === 0) {
                        window.open('https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln', '_blank');
                      } else if (plan.id === 'pro') {
                        setNotification({ ...notification, show: true });
                      } else {
                        handleButtonClick(plan.id);
                      }
                    }}
                    disabled={isCurrentPlan || (isLoading !== null && plan.priceMonthly > 0)}
                    className={`
                    w-full py-3 text-base font-bold rounded-full mb-8
                    flex items-center justify-center gap-2
                    transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                    hover:scale-[1.05]
                    ${isCurrentPlan
                        ? 'bg-green-500 text-white'
                        : isGold
                          ? 'bg-gold-500 text-black'
                          : 'bg-black text-white'
                      }
                    cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100
                  `}
                  >
                    {isCurrentPlan ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>{t('currentPlan')}</span>
                      </>
                    ) : isLoading === plan.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t('redirecting')}</span>
                      </>
                    ) : (
                      plan.priceMonthly === 0 ? t('getStarted') : t('subscribe')
                    )}
                  </button>

                  {/* Features List */}
                  <div>
                  {t(`plans.${plan.translationKey}.featureHeader`) && (
                    <p className={`text-sm font-medium mb-3 ${isCurrentPlan || isGold ? 'text-slate-400' : 'text-slate-500'}`}>
                      {t(`plans.${plan.translationKey}.featureHeader`)}
                    </p>
                  )}
                  <ul className="space-y-2 mb-4">
                    {Array.from({ length: plan.featureCount }).map((_, idx) => {
                      const isPro = plan.id === 'pro';
                      return (
                        <li key={idx} className={`flex items-start gap-3 text-sm leading-normal ${isPro ? 'text-slate-900' : isCurrentPlan || isGold ? 'text-slate-300' : 'text-slate-500'}`}>
                          <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isPro ? 'text-gold-400' : isCurrentPlan ? 'text-green-500' : isGold ? 'text-gold-500' : 'text-slate-900'}`} />
                          <span>{t(`plans.${plan.translationKey}.features.${idx}`)}</span>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Free plan: 分隔线 + 完全免费功能 */}
                  {plan.freeFeatureCount && plan.freeFeatureCount > 0 && (
                    <>
                      <div className="border-t border-slate-100 my-4" />
                      <p className="text-sm font-medium mb-3 text-slate-500">
                        {t(`plans.${plan.translationKey}.freeFeatureHeader`)}
                      </p>
                      <ul className="space-y-2 mb-4">
                        {Array.from({ length: plan.freeFeatureCount }).map((_, idx) => (
                          <li key={idx} className="flex items-start gap-3 text-sm leading-normal text-slate-500">
                            <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-900" />
                            <span>{t(`plans.${plan.translationKey}.freeFeatures.${idx}`)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile Pagination Dots */}
          <div className="flex md:hidden justify-center gap-2 mt-4">
            {planConfigs.map((_, index) => (
              <button
                key={index}
                onClick={() => scrollToCard(index)}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${activeIndex === index
                    ? 'bg-slate-900 w-4'
                    : 'bg-slate-300 hover:bg-slate-400'
                  }`}
                aria-label={`Go to plan ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => {
          setShowLoginModal(false);
          setPendingPlan(null);
        }}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* Coming Soon Notification */}
      <SimpleNotify
        notification={notification}
        setShow={(show) => setNotification({ ...notification, show })}
      />
    </section>
  );
};

export default Pricing;
