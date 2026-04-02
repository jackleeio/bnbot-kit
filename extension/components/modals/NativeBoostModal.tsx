import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { boostService, tokenToWei } from '../../services/boostService';
import { useLanguage } from '../LanguageContext';

interface NativeBoostModalProps {
    tweetText: string;
    tweetId: string;
    tweetUrl: string;
    onClose: () => void;
}

type Step = 'budget' | 'submitting' | 'waiting' | 'success' | 'error';

const BUDGET_PRESETS = [10, 25, 50, 100, 150, 200, 250, 500, 1000, 2500, 5000, 10000];

export function NativeBoostModal({ tweetText, tweetId, tweetUrl, onClose }: NativeBoostModalProps) {
    const { t } = useLanguage();
    const [mounted, setMounted] = useState(false);
    const [step, setStep] = useState<Step>('budget');
    const [errorMessage, setErrorMessage] = useState('');
    const [createdBoostId, setCreatedBoostId] = useState<string | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Budget State - index into BUDGET_PRESETS
    const [budgetIndex, setBudgetIndex] = useState(7); // default 500
    const totalBudget = BUDGET_PRESETS[budgetIndex];
    const [duration, setDuration] = useState(5);
    const [showAdvanced, setShowAdvanced] = useState(false);
    // Pool allocation: replier + quoter = 100 (no retweeter)
    const [replierPct, setReplierPct] = useState(30);
    const quoterPct = 100 - replierPct;
    const [editingPool, setEditingPool] = useState<'quoter' | 'replier' | null>(null);
    const [editValue, setEditValue] = useState('');

    const bm = (t as any).boostModal || {};

    useEffect(() => {
        setMounted(true);
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && step !== 'submitting') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose, step]);

    // Poll boost status when waiting for payment
    useEffect(() => {
        if (step !== 'waiting' || !createdBoostId) return;

        pollingRef.current = setInterval(async () => {
            try {
                const boost = await boostService.getBoost(createdBoostId);
                if (boost && boost.status === 'active') {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setStep('success');
                }
            } catch {
                // Ignore polling errors, keep trying
            }
        }, 3000);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [step, createdBoostId]);

    if (!mounted) return null;

    const BinanceGold = '#F0B90B';
    const budgetSliderPct = budgetIndex / (BUDGET_PRESETS.length - 1) * 100;
    const durationSliderPct = (duration - 1) / (30 - 1) * 100;

    const handleSubmit = async () => {
        if (!tweetId) {
            setErrorMessage(bm.noTweetId || 'Could not detect tweet ID.');
            setStep('error');
            return;
        }

        setStep('submitting');
        setErrorMessage('');

        try {
            // Step 1: Create Boost record (PENDING status)
            const boost = await boostService.createBoost({
                tweet_id: tweetId,
                tweet_url: tweetUrl || undefined,
                sponsor_address: '0x0000000000000000000000000000000000000000',
                total_budget: tokenToWei(totalBudget.toString(), 6),
                token_type: 'ERC20',
                token_symbol: 'USDC',
                token_address: '0x79E147d621B3d8dE20E46877bA070c49aD156cea',
                chain_id: 97,
                duration_days: duration,
                quoter_pool_percentage: quoterPct / 100,
                retweeter_pool_percentage: 0,
                replier_pool_percentage: replierPct / 100,
            });

            if (!boost?.id) {
                throw new Error('Failed to create boost record');
            }

            setCreatedBoostId(boost.id);

            // Step 2: Create Stripe Checkout Session
            const { checkout_url } = await boostService.createCheckoutSession(boost.id, totalBudget);

            if (!checkout_url) {
                throw new Error('Failed to get checkout URL');
            }

            // Step 3: Open Stripe Checkout in new tab, stay on modal
            if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                chrome.tabs.create({ url: checkout_url });
            } else {
                window.open(checkout_url, '_blank');
            }

            setStep('waiting');
        } catch (error: any) {
            console.error('[BoostModal] Error:', error);
            setErrorMessage(error.message || 'Something went wrong. Please try again.');
            setStep('error');
        }
    };

    const renderBudgetStep = () => (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div className="css-175oi2r r-1f0wa7y" style={{ padding: '0 32px' }}>

                {/* Title */}
                <div className="css-175oi2r r-zo2zu6 r-1l7z4oj" style={{ margin: '12px 0 24px 0' }}>
                    <h1 dir="ltr" aria-level={1} role="heading" className="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-fdjqy7 r-1blvdjr r-vrz42v r-1vr29t4" style={{ color: 'rgb(15, 20, 25)', fontSize: '24px', fontWeight: 800 }}>
                        <span className="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3">{bm.title}</span>
                    </h1>
                </div>

                {/* Total Budget */}
                <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center', width: '100%' }}>
                        <span style={{ fontWeight: 700, fontSize: '16px', color: 'rgb(15, 20, 25)' }}>{bm.totalBudget}</span>
                        <span style={{ fontWeight: 500, fontSize: '18px', color: 'rgb(15, 20, 25)' }}>${totalBudget}</span>
                    </div>
                    <div style={{ height: '30px', position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                        <input
                            type="range"
                            min="0"
                            max={BUDGET_PRESETS.length - 1}
                            step="1"
                            value={budgetIndex}
                            onChange={(e) => setBudgetIndex(Number(e.target.value))}
                            style={{
                                width: '100%',
                                height: '4px',
                                background: `linear-gradient(to right, ${BinanceGold} 0%, ${BinanceGold} ${budgetSliderPct}%, rgb(239, 243, 244) ${budgetSliderPct}%, rgb(239, 243, 244) 100%)`,
                                borderRadius: '2px',
                                outline: 'none',
                                appearance: 'none',
                                cursor: 'pointer'
                            }}
                        />
                        <style>{`
              input[type=range]::-webkit-slider-thumb {
                -webkit-appearance: none;
                height: 20px;
                width: 20px;
                border-radius: 50%;
                background: ${BinanceGold};
                cursor: pointer;
                box-shadow: 0 0 2px rgba(0,0,0,0.2);
              }
            `}</style>
                    </div>
                </div>

                {/* Duration */}
                <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center', width: '100%' }}>
                        <span style={{ fontWeight: 700, fontSize: '16px', color: 'rgb(15, 20, 25)' }}>{bm.duration}</span>
                        <span style={{ fontWeight: 500, fontSize: '18px', color: 'rgb(15, 20, 25)' }}>{duration} {bm.days}</span>
                    </div>
                    <div style={{ height: '30px', position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                        <input
                            type="range"
                            min="1"
                            max="30"
                            step="1"
                            value={duration}
                            onChange={(e) => setDuration(Number(e.target.value))}
                            style={{
                                width: '100%',
                                height: '4px',
                                background: `linear-gradient(to right, ${BinanceGold} 0%, ${BinanceGold} ${durationSliderPct}%, rgb(239, 243, 244) ${durationSliderPct}%, rgb(239, 243, 244) 100%)`,
                                borderRadius: '2px',
                                outline: 'none',
                                appearance: 'none',
                                cursor: 'pointer'
                            }}
                        />
                    </div>
                </div>

                {/* Advanced: Pool Allocation */}
                <div style={{ marginBottom: '32px' }}>
                    <div
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: showAdvanced ? '16px' : '0' }}
                        onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                        <svg viewBox="0 0 24 24" style={{
                            width: '16px', height: '16px', fill: 'rgb(83, 100, 113)',
                            transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s'
                        }}>
                            <path d="M14.586 12L7.543 4.96l1.414-1.42L17.414 12l-8.457 8.46-1.414-1.42L14.586 12z" />
                        </svg>
                        <span style={{ fontWeight: 700, fontSize: '15px', color: 'rgb(83, 100, 113)' }}>{bm.rewardSplit}</span>
                    </div>

                    {showAdvanced && (
                        <div>
                            {/* Labels - Replier (left) / Quoter (right) */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '13px', fontWeight: 600 }}>
                                {/* Replier (left, gray) */}
                                {editingPool === 'replier' ? (
                                    <span style={{ color: 'rgb(83, 100, 113)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                        {bm.replier} <input
                                            autoFocus
                                            type="number"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            onBlur={() => {
                                                const v = Math.max(5, Math.min(95, parseInt(editValue) || 5));
                                                setReplierPct(v);
                                                setEditingPool(null);
                                            }}
                                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                            style={{ width: '36px', border: 'none', borderBottom: '2px solid rgb(83, 100, 113)', outline: 'none', fontSize: '13px', fontWeight: 600, color: 'rgb(83, 100, 113)', textAlign: 'center', background: 'transparent', padding: 0 }}
                                        />%
                                    </span>
                                ) : (
                                    <span style={{ color: 'rgb(83, 100, 113)', cursor: 'pointer' }} onClick={() => { setEditingPool('replier'); setEditValue(String(replierPct)); }}>
                                        {bm.replier} {replierPct}%
                                    </span>
                                )}
                                {/* Quoter (right, gold) */}
                                {editingPool === 'quoter' ? (
                                    <span style={{ color: BinanceGold, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                        {bm.quoter} <input
                                            autoFocus
                                            type="number"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            onBlur={() => {
                                                const v = Math.max(5, Math.min(95, parseInt(editValue) || 5));
                                                setReplierPct(100 - v);
                                                setEditingPool(null);
                                            }}
                                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                            style={{ width: '36px', border: 'none', borderBottom: `2px solid ${BinanceGold}`, outline: 'none', fontSize: '13px', fontWeight: 600, color: BinanceGold, textAlign: 'center', background: 'transparent', padding: 0 }}
                                        />%
                                    </span>
                                ) : (
                                    <span style={{ color: BinanceGold, cursor: 'pointer' }} onClick={() => { setEditingPool('quoter'); setEditValue(String(quoterPct)); }}>
                                        {bm.quoter} {quoterPct}%
                                    </span>
                                )}
                            </div>

                            {/* Two-segment slider: Replier(gray) | Quoter(gold) */}
                            <div style={{ height: '30px', position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                                <input
                                    type="range"
                                    min="5"
                                    max="95"
                                    step="1"
                                    value={replierPct}
                                    onChange={(e) => setReplierPct(Number(e.target.value))}
                                    style={{
                                        width: '100%',
                                        height: '4px',
                                        background: `linear-gradient(to right, rgb(239, 243, 244) 0%, rgb(239, 243, 244) ${replierPct}%, ${BinanceGold} ${replierPct}%, ${BinanceGold} 100%)`,
                                        borderRadius: '2px',
                                        outline: 'none',
                                        appearance: 'none',
                                        cursor: 'pointer'
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Estimated Reach */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', width: '100%' }}>
                    <span style={{ fontWeight: 800, fontSize: '17px', color: 'rgb(15, 20, 25)' }}>{bm.estimatedDailyReach}</span>
                    <div style={{
                        backgroundColor: '#C8F5F8',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontWeight: 800,
                        fontSize: '17px',
                        color: 'rgb(15, 20, 25)'
                    }}>
                        1.6万 - 3.7万
                    </div>
                </div>

                {/* Payment & Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', width: '100%' }}>
                    {/* Left: Payment Method */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 800, fontSize: '17px', color: 'rgb(15, 20, 25)' }}>{bm.paymentMethod}</span>
                        </div>
                        <div style={{ color: 'rgb(83, 100, 113)', fontSize: '15px' }}>{bm.stripeCard}</div>
                    </div>

                    {/* Right: Total */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span style={{ fontWeight: 800, fontSize: '17px', marginBottom: '4px', color: 'rgb(15, 20, 25)' }}>{duration} {bm.dayTotal}</span>
                        <span style={{ color: 'rgb(83, 100, 113)', fontSize: '15px' }}>${totalBudget.toFixed(2)}</span>
                    </div>
                </div>

                {/* Action Button */}
                <div
                    role="button"
                    className="css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-16lk18l r-1s2bzr4 r-19yznuf r-64el8z r-1fkl15p r-o7ynqc r-6416eg r-1ny4l3l r-1loqt21"
                    style={{ backgroundColor: BinanceGold, borderColor: 'rgba(0, 0, 0, 0)', margin: '0 0 24px 0', cursor: tweetId ? 'pointer' : 'not-allowed', borderRadius: '9999px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', opacity: tweetId ? 1 : 0.5 }}
                    onClick={tweetId ? handleSubmit : undefined}
                >
                    <div dir="ltr" className="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci" style={{ color: 'rgb(0, 0, 0)' }}>
                        <span className="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3" style={{ fontSize: '17px', fontWeight: 700 }}>{bm.payAmount} ${totalBudget}</span>
                    </div>
                </div>

                {/* Disclaimer */}
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'rgb(83, 100, 113)', marginBottom: '16px', width: '100%' }}>
                    {bm.disclaimer}
                </div>

            </div>
        </div>
    );

    const renderSubmitting = () => (
        <div style={{ padding: '80px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{
                width: '40px', height: '40px', border: `3px solid ${BinanceGold}`,
                borderTopColor: 'transparent', borderRadius: '50%',
                animation: 'bnbot-boost-spin 0.8s linear infinite'
            }} />
            <style>{`@keyframes bnbot-boost-spin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ fontSize: '17px', fontWeight: 700, color: 'rgb(15, 20, 25)' }}>
                {bm.processing}
            </span>
            <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)' }}>
                {bm.redirecting}
            </span>
        </div>
    );

    const renderWaiting = () => (
        <div style={{ padding: '60px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <div style={{
                width: '48px', height: '48px', border: `3px solid ${BinanceGold}`,
                borderTopColor: 'transparent', borderRadius: '50%',
                animation: 'bnbot-boost-spin 0.8s linear infinite'
            }} />
            <style>{`@keyframes bnbot-boost-spin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ fontSize: '20px', fontWeight: 800, color: 'rgb(15, 20, 25)' }}>
                {bm.waitingPayment}
            </span>
            <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)', textAlign: 'center', lineHeight: '1.5' }}>
                {bm.waitingPaymentDesc}<br />{bm.waitingPaymentAutoUpdate}
            </span>

            {/* Close button */}
            <div
                role="button"
                className="css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-16lk18l r-1s2bzr4 r-19yznuf r-64el8z r-1fkl15p r-o7ynqc r-6416eg r-1ny4l3l r-1loqt21"
                style={{ backgroundColor: 'rgb(15, 20, 25)', borderColor: 'rgba(0, 0, 0, 0)', cursor: 'pointer', borderRadius: '9999px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: '12px' }}
                onClick={onClose}
            >
                <div dir="ltr" className="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci" style={{ color: 'rgb(255, 255, 255)' }}>
                    <span className="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3" style={{ fontSize: '15px', fontWeight: 700 }}>{bm.close}</span>
                </div>
            </div>
        </div>
    );

    const renderSuccess = () => (
        <div style={{ padding: '60px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <div style={{
                width: '56px', height: '56px', borderRadius: '50%',
                backgroundColor: '#dcfce7', display: 'flex',
                alignItems: 'center', justifyContent: 'center'
            }}>
                <svg viewBox="0 0 24 24" style={{ width: '32px', height: '32px', fill: '#16a34a' }}>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
            </div>
            <span style={{ fontSize: '20px', fontWeight: 800, color: 'rgb(15, 20, 25)' }}>
                {bm.paymentSuccess}
            </span>
            <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)', textAlign: 'center', lineHeight: '1.5' }}>
                {bm.paymentSuccessDesc}
            </span>

            <div
                role="button"
                className="css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-16lk18l r-1s2bzr4 r-19yznuf r-64el8z r-1fkl15p r-o7ynqc r-6416eg r-1ny4l3l r-1loqt21"
                style={{ backgroundColor: BinanceGold, borderColor: 'rgba(0, 0, 0, 0)', cursor: 'pointer', borderRadius: '9999px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: '12px' }}
                onClick={onClose}
            >
                <div dir="ltr" className="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci" style={{ color: 'rgb(0, 0, 0)' }}>
                    <span className="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3" style={{ fontSize: '15px', fontWeight: 700 }}>{bm.done}</span>
                </div>
            </div>
        </div>
    );

    const renderError = () => (
        <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{
                padding: '12px 16px', backgroundColor: '#fef2f2',
                borderRadius: '12px', border: '1px solid #fecaca',
                color: '#dc2626', fontSize: '15px'
            }}>
                {errorMessage}
            </div>
            <div
                role="button"
                className="css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-16lk18l r-1s2bzr4 r-19yznuf r-64el8z r-1fkl15p r-o7ynqc r-6416eg r-1ny4l3l r-1loqt21"
                style={{ backgroundColor: BinanceGold, borderColor: 'rgba(0, 0, 0, 0)', cursor: 'pointer', borderRadius: '9999px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}
                onClick={() => setStep('budget')}
            >
                <div dir="ltr" className="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci" style={{ color: 'rgb(0, 0, 0)' }}>
                    <span className="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3" style={{ fontSize: '15px', fontWeight: 700 }}>{bm.tryAgain}</span>
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(
        <div className="r-zchlnj r-1d2f490 r-u8s1d r-ipm5af" id="layers" style={{
            zIndex: 2147483647,
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'auto'
        }}>
            <div className="css-175oi2r r-aqfbo4 r-zchlnj r-1d2f490 r-1xcajam r-1p0dtai r-12vffkv" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw' }}>
                <div className="css-175oi2r r-12vffkv" style={{ position: 'relative', width: '100%', maxWidth: '600px', maxHeight: '90vh', backgroundColor: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 0 15px rgba(0,0,0,0.1)' }}>
                    {/* Main Modal Container */}
                    <div className="css-175oi2r r-12vffkv" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* Scrollable Content */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {step === 'budget' && renderBudgetStep()}
                            {step === 'submitting' && renderSubmitting()}
                            {step === 'waiting' && renderWaiting()}
                            {step === 'success' && renderSuccess()}
                            {step === 'error' && renderError()}
                        </div>

                    </div>
                </div>
            </div>

            {/* Background Mask */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    zIndex: -1
                }}
                onClick={step !== 'submitting' ? onClose : undefined}
            />
        </div>,
        document.body
    );
}
