'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
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
  isHighlighted: boolean;
  featureCount: number;
  freeFeatureCount?: number;
  hasBadge?: boolean;
}

const plans: PlanConfig[] = [
  { id: 'starter', translationKey: 'starter', priceMonthly: 0, priceYearly: 0, isHighlighted: false, featureCount: 3, freeFeatureCount: 5 },
  { id: 'basic', translationKey: 'basic', priceMonthly: 24, priceYearly: 19, originalPriceMonthly: 32, isHighlighted: true, featureCount: 14, hasBadge: true },
  { id: 'pro', translationKey: 'pro', priceMonthly: 49, priceYearly: 39, originalPriceMonthly: 69, isHighlighted: false, featureCount: 4 },
];

const Pricing: React.FC = () => {
  const { t } = useHomeTranslations('home.pricing');
  const { isLoggedIn } = useAuth();
  const [isAnnual, setIsAnnual] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showLogin, setShowLogin] = useState(false);
  const [pending, setPending] = useState<PlanType | null>(null);
  const [loading, setLoading] = useState<PlanType | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [notif, setNotif] = useState({ show: false, title: 'Coming Soon', msg: 'Ultimate plan is coming soon!', type: 'warning' as const });
  const [currentPlan, setCurrentPlan] = useState<PlanType | null>(null);

  useEffect(() => {
    if (!isLoggedIn) { setCurrentPlan(null); return; }
    StripeService.getSubscriptionStatus().then(r => {
      if (r.has_subscription && r.subscription?.status === 'active') setCurrentPlan(r.subscription.plan_name);
    }).catch(() => {});
  }, [isLoggedIn]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const h = () => { const w = c.scrollWidth / plans.length; setActiveIdx(Math.min(Math.round(c.scrollLeft / w), plans.length - 1)); };
    c.addEventListener('scroll', h);
    return () => c.removeEventListener('scroll', h);
  }, []);

  const goCheckout = async (id: PlanType) => {
    setLoading(id);
    try { await StripeService.redirectToCheckout(id, isAnnual ? 'year' : 'month'); }
    catch (e: any) {
      const d = e?.response?.data?.detail || e?.message || '';
      setNotif({ show: true, title: d.includes('already') ? 'Already Subscribed' : 'Error', msg: d || 'Failed to create checkout session', type: 'warning' });
    } finally { setLoading(null); }
  };

  const subscribe = (id: PlanType) => {
    if (!isLoggedIn) { setPending(id); setShowLogin(true); return; }
    goCheckout(id);
  };

  return (
    <section id="pricing" className="py-20 md:py-32">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-space-text md:text-5xl">
            {t('title')} <span className="bg-gradient-to-r from-coral-500 to-coral-400 bg-clip-text text-transparent">{t('titleHighlight')}</span> {t('titleSuffix')}
          </h2>
          <p className="mb-8 text-lg text-space-muted">{t('subtitle')}</p>

          <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-1 h-12 select-none">
            <button onClick={() => setIsAnnual(false)} className={`w-36 h-10 rounded-full text-sm font-semibold transition-all ${!isAnnual ? 'bg-white/10 text-space-text' : 'text-space-muted'}`}>{t('monthly')}</button>
            <button onClick={() => setIsAnnual(true)} className={`w-36 h-10 rounded-full text-sm font-semibold transition-all flex items-center justify-center gap-2 ${isAnnual ? 'bg-white/10 text-space-text' : 'text-space-muted'}`}>
              {t('yearly')} <span className="rounded-full bg-coral-500 px-2 py-0.5 text-[9px] font-bold text-white">{t('discount')}</span>
            </button>
          </div>
        </motion.div>

        <div className="md:grid md:grid-cols-3 gap-8 items-stretch relative">
          <div ref={scrollRef} className="flex items-stretch md:contents overflow-x-auto pb-8 md:pb-0 gap-4 snap-x snap-mandatory md:gap-8" style={{ paddingInline: '6vw', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
            {plans.map((plan) => {
              const isCurrent = currentPlan === plan.id;
              const hi = plan.isHighlighted;
              const badge = plan.hasBadge ? t(`plans.${plan.translationKey}.badge`) : null;

              return (
                <div key={plan.id} className={`relative rounded-3xl p-6 sm:p-8 flex flex-col flex-shrink-0 w-[88vw] md:w-auto snap-center border ${isCurrent ? 'border-green-500/30 bg-space-surface' : hi ? 'border-coral-500/30 bg-space-surface shadow-[0_0_30px_rgba(255,77,77,0.12)]' : 'border-white/[0.08] bg-[rgba(10,15,26,0.65)]'}`}>
                  {badge && (
                    <div className="flex justify-end mb-2 -mt-1">
                      <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full ${isCurrent ? 'bg-green-500 text-white' : 'bg-coral-500 text-white'}`}>{badge}</span>
                    </div>
                  )}

                  <h3 className={`text-lg font-semibold mb-1 text-space-text ${!badge ? 'mt-6' : ''}`}>{t(`plans.${plan.translationKey}.name`)}</h3>

                  <div className="flex items-baseline gap-1 mb-1 h-12">
                    {plan.originalPriceMonthly && isAnnual && <span className="text-[2.1rem] font-bold line-through text-space-dim">${plan.priceMonthly}</span>}
                    <span className={`text-4xl font-bold ${isCurrent ? 'text-green-400' : hi ? 'text-coral-500' : 'text-space-text'}`}>${isAnnual ? plan.priceYearly : plan.priceMonthly}</span>
                    {plan.priceMonthly > 0 && <span className="text-xs text-space-dim">/mo</span>}
                  </div>
                  <div className="text-xs mb-4 invisible">-</div>

                  <div className={`rounded-xl py-3 px-4 mb-4 text-center text-sm font-bold ${isCurrent ? 'bg-green-500/10 text-green-400' : hi ? 'bg-coral-500/10 text-coral-500' : 'bg-white/[0.03] text-space-muted'}`}>
                    {t(`plans.${plan.translationKey}.credits`)}
                  </div>

                  <button
                    onClick={() => { if (isCurrent) return; if (plan.priceMonthly === 0) window.open('https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln', '_blank'); else if (plan.id === 'pro') setNotif({ ...notif, show: true }); else subscribe(plan.id); }}
                    disabled={isCurrent || (loading !== null && plan.priceMonthly > 0)}
                    className={`w-full py-3 text-base font-bold rounded-full mb-8 flex items-center justify-center gap-2 transition-transform duration-300 hover:scale-[1.05] disabled:opacity-70 disabled:hover:scale-100 ${isCurrent ? 'bg-green-500 text-white' : hi ? 'bg-coral-500 text-white' : 'bg-white/10 text-space-text hover:bg-white/15'}`}
                  >
                    {isCurrent ? <><Check className="w-4 h-4" />{t('currentPlan')}</> : loading === plan.id ? <><Loader2 className="w-4 h-4 animate-spin" />{t('redirecting')}</> : plan.priceMonthly === 0 ? t('getStarted') : t('subscribe')}
                  </button>

                  <div>
                    {t(`plans.${plan.translationKey}.featureHeader`) && <p className="text-sm font-medium mb-3 text-space-dim">{t(`plans.${plan.translationKey}.featureHeader`)}</p>}
                    <ul className="space-y-2 mb-4">
                      {Array.from({ length: plan.featureCount }).map((_, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-space-muted">
                          <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isCurrent ? 'text-green-500' : hi ? 'text-coral-500' : 'text-space-text'}`} />
                          <span>{t(`plans.${plan.translationKey}.features.${i}`)}</span>
                        </li>
                      ))}
                    </ul>
                    {plan.freeFeatureCount && plan.freeFeatureCount > 0 && (
                      <>
                        <div className="border-t border-white/[0.06] my-4" />
                        <p className="text-sm font-medium mb-3 text-space-dim">{t(`plans.${plan.translationKey}.freeFeatureHeader`)}</p>
                        <ul className="space-y-2 mb-4">
                          {Array.from({ length: plan.freeFeatureCount }).map((_, i) => (
                            <li key={i} className="flex items-start gap-3 text-sm text-space-muted">
                              <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-space-text" />
                              <span>{t(`plans.${plan.translationKey}.freeFeatures.${i}`)}</span>
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

          <div className="flex md:hidden justify-center gap-2 mt-4">
            {plans.map((_, i) => (
              <button key={i} onClick={() => { const c = scrollRef.current; if (c) c.scrollTo({ left: (c.scrollWidth / plans.length) * i, behavior: 'smooth' }); }}
                className={`w-2 h-2 rounded-full transition-all ${activeIdx === i ? 'bg-coral-500 w-4' : 'bg-white/20'}`} />
            ))}
          </div>
        </div>
      </div>

      <LoginModal isOpen={showLogin} onClose={() => { setShowLogin(false); setPending(null); }} onLoginSuccess={() => { setShowLogin(false); if (pending) { goCheckout(pending); setPending(null); } }} />
      <SimpleNotify notification={notif} setShow={(s) => setNotif({ ...notif, show: s })} />
    </section>
  );
};

export default Pricing;
