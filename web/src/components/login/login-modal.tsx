'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { GoogleIcon } from '@/components/icons/google';
import { useAuth } from '@/lib/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void;
  showInviteCode?: boolean;
}

export default function LoginModal({ isOpen, onClose, onLoginSuccess, showInviteCode = false }: LoginModalProps) {
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeTimer, setCodeTimer] = useState(0);
  const [isCodeValid, setIsCodeValid] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const t = useTranslations('login');

  // Handle escape key
  useEffect(() => {
    if (isOpen) {
      // Only show invitation code if explicitly enabled via prop
      if (showInviteCode) {
        const storedInviteCode = localStorage.getItem('invite_code');
        if (storedInviteCode) {
          setInviteCode(storedInviteCode);
        } else {
          setInviteCode(null);
        }
      } else {
        setInviteCode(null);
      }

      document.body.style.overflow = 'hidden';
      
      const handleEscKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          onClose();
        }
      };
      
      document.addEventListener('keydown', handleEscKey);
      
      return () => {
        document.body.style.overflow = 'auto';
        document.removeEventListener('keydown', handleEscKey);
      };
    }
  }, [isOpen, onClose]);

  // Timer for verification code
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (codeTimer > 0) {
      interval = setInterval(() => {
        setCodeTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [codeTimer]);



  const sendVerificationCode = async () => {
    if (!email) {
      console.warn('Email address is required');
      return;
    }

    setIsLoading(true);

    try {
      await apiClient.post('/api/v1/send-verification-code', { email });
      setCodeSent(true);
      setCodeTimer(60); // 60 second cooldown
    } catch (error) {
      console.error('Error sending verification code:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const validateVerificationCode = async (code: string) => {
    if (!code || code.length < 6) {
      setIsCodeValid(null);
      return;
    }

    setIsValidating(true);

    try {
      await apiClient.post('/api/v1/verify-email', { email, code });
      setIsCodeValid(true);
    } catch (error) {
      console.error('Code validation error:', error);
      setIsCodeValid(false);
    } finally {
      setIsValidating(false);
    }
  };

  const handleEmailLogin = async () => {
    if (!isCodeValid) {
      return;
    }

    setIsLoading(true);

    try {
      // 使用 useAuth hook 的 login 方法
      // httpOnly Cookie 自动由后端设置，前端无需处理 token
      await login(email, verificationCode, inviteCode);

      // Clear invite code after successful login
      localStorage.removeItem('invite_code');

      onClose();
      onLoginSuccess?.();
    } catch (error) {
      console.error('Email login error:', error);
      setIsCodeValid(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setIsGoogleLoading(true);

    try {
      // Use Google Identity Services for popup-based flow
      if (typeof window !== 'undefined' && (window as any).google && (window as any).google.accounts) {
        // Initialize Google OAuth
        (window as any).google.accounts.id.initialize({
          client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
          callback: async (response: any) => {
            try {
              // 使用 useAuth hook 的 googleLogin 方法
              // httpOnly Cookie 自动由后端设置
              await googleLogin(response.credential, inviteCode);

              // Clear invite code after successful login
              localStorage.removeItem('invite_code');

              onClose();
              onLoginSuccess?.();
            } catch (error) {
              console.error('Google OAuth error:', error);
              setIsGoogleLoading(false);
            }
          }
        });

        // Use popup instead of One Tap to avoid FedCM issues
        (window as any).google.accounts.id.renderButton(
          document.getElementById('google-signin-button'),
          {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            text: 'signin_with'
          }
        );

        // Trigger the button click programmatically
        setTimeout(() => {
          const button = document.getElementById('google-signin-button')?.querySelector('div[role="button"]') as HTMLElement;
          if (button) {
            button.click();
          } else {
            setIsGoogleLoading(false);
          }
        }, 100);

      } else {
        console.error('Google Identity Services not available');
        setIsGoogleLoading(false);
      }
    } catch (error) {
      console.error('Error with Google login:', error);
      setIsGoogleLoading(false);
    }
  };






  const resetForm = () => {
    setEmail('');
    setVerificationCode('');
    setIsLoading(false);
    setIsGoogleLoading(false);
    setCodeSent(false);
    setCodeTimer(0);
    setIsCodeValid(null);
    setIsValidating(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Only render portal on client side
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          className="relative w-full max-w-md mx-4 rounded-2xl bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >

            {codeSent && (
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false);
                  setVerificationCode('');
                  setCodeTimer(0);
                  setIsCodeValid(null);
                  setIsValidating(false);
                }}
                className="absolute left-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-100 text-gray-500 transition hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                aria-label="Back to sign in options"
              >
                <svg
                  className="h-4 w-4 text-gray-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
            )}


            {/* Header */}
            <div className="mb-8 text-center">
              <h2 className="text-xl font-medium text-gray-800 mb-4">
                {codeSent ? t('enterCode') : t('title')}
              </h2>
              {inviteCode && !codeSent && (
                <div className="mb-4 p-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  {t('inviteCode')} <span className="font-bold text-green-600">{inviteCode}</span>
                </div>
              )}
              {codeSent ? (
                <p className="text-sm text-gray-600 leading-relaxed max-w-sm mx-auto">
                  {t('codeSentTo')} <span className="font-medium text-gray-800">{email}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-600">
                  {t('accessFeatures')}
                </p>
              )}
            </div>

            {/* Google Login Button - Only show when code not sent */}
            {!codeSent && (
              <>
                <div className="mb-4">
                  <button
                    onClick={handleGoogleLogin}
                    disabled={isGoogleLoading}
                    className="w-full h-14 bg-white border border-gray-200/80 text-gray-700 rounded-full font-medium flex items-center justify-center gap-3 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {isGoogleLoading && <span className="loading loading-spinner loading-sm"></span>}
                    {isGoogleLoading ? (
                      t('connecting')
                    ) : (
                      <>
                        <GoogleIcon className="h-5 w-5" />
                        {t('continueGoogle')}
                      </>
                    )}
                  </button>
                </div>

                {/* Divider */}
                <div className="mb-4 flex items-center">
                  <div className="flex-1 border-t border-gray-200"></div>
                  <div className="mx-3 text-xs text-gray-500">{t('or')}</div>
                  <div className="flex-1 border-t border-gray-200"></div>
                </div>
              </>
            )}

            {/* Email Login Form - Initial State */}
            {!codeSent && (
              <div className="space-y-5">
                <div>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block h-14 w-full rounded-full border border-gray-200/80 bg-white px-6 py-4 text-base text-center placeholder-gray-400 transition-colors duration-200 focus:border-[#f0b90b] focus:outline-none focus:ring-0 focus:shadow-none disabled:border-gray-100 disabled:bg-gray-50 disabled:text-gray-500"
                    placeholder={t('enterEmail')}
                    required
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <button
                    type="button"
                    onClick={sendVerificationCode}
                    disabled={isLoading || !email || codeTimer > 0}
                    className="w-full h-14 bg-black text-white text-base font-medium rounded-full transition-all duration-200 hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                  >
                    {isLoading && (
                      <span className="loading loading-spinner loading-xs mr-2 text-gray-600" />
                    )}
                    {codeTimer > 0 ? t('resendIn', { seconds: codeTimer }) : isLoading ? t('sending') : t('continueEmail')}
                  </button>
                </div>
              </div>
            )}

            {/* Verification Code State */}
            {codeSent && (
              <div className="space-y-5 animate-in fade-in-50 duration-300">
                <div className="relative">
                  <input
                    type="text"
                    id="verificationCode"
                    value={verificationCode}
                    onChange={(e) => {
                      const newCode = e.target.value;
                      setVerificationCode(newCode);
                      if (newCode.length === 6) {
                        validateVerificationCode(newCode);
                      } else {
                        setIsCodeValid(null);
                      }
                    }}
                    className={`block h-14 w-full rounded-full border bg-white px-6 py-4 text-base text-center placeholder-gray-400 transition-colors duration-200 focus:outline-none focus:ring-0 focus:shadow-none disabled:border-gray-100 disabled:bg-gray-50 disabled:text-gray-500 ${
                      isCodeValid === true
                        ? 'border-green-300 focus:border-green-400'
                        : isCodeValid === false
                        ? 'border-red-300 focus:border-red-400'
                        : 'border-gray-200 focus:border-[#f0b90b]'
                    }`}
                    placeholder={t('sixDigitCode')}
                    required
                    disabled={isLoading}
                    maxLength={6}
                    autoFocus
                  />
                  {isValidating && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500">
                      <span className="loading loading-spinner loading-xs"></span>
                    </div>
                  )}
                  {isCodeValid === true && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-green-500">
                      ✓
                    </div>
                  )}
                  {isCodeValid === false && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-red-500">
                      ✗
                    </div>
                  )}
                </div>

                <div>
                  <button
                    onClick={handleEmailLogin}
                    disabled={isLoading || !verificationCode || isCodeValid !== true || isValidating}
                    className="w-full h-14 bg-black text-white text-base font-medium rounded-full transition-all duration-200 hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                  >
                    {isLoading && (
                      <span className="loading loading-spinner loading-xs mr-2 text-gray-600" />
                    )}
                    {isLoading ? t('signingIn') : t('signIn')}
                  </button>
                </div>

                <div className="text-center pt-2">
                  <p className="text-sm text-gray-500">
                    {t('didntGetEmail')}{' '}
                    <button
                      onClick={() => {
                        setCodeSent(false);
                        setVerificationCode('');
                        setCodeTimer(0);
                        setIsCodeValid(null);
                        setIsValidating(false);
                      }}
                      className="text-gray-700 hover:text-gray-900 underline font-normal"
                      disabled={isLoading}
                    >
                      {t('resend')}
                    </button>
                  </p>
                </div>
              </div>
            )}




            {/* Hidden Google Sign-In Button for rendering */}
            <div id="google-signin-button" style={{ display: 'none' }}></div>



            {/* Footer */}
            {/* <div className="mt-8 text-center">
              <p className="text-[11px] md:text-xs text-gray-500 leading-relaxed">
                By continuing, you acknowledge our{' '}
                <span className="underline">Privacy Policy</span>{' '}
                and agree to get occasional product update and promotional emails.
              </p>
            </div> */}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
