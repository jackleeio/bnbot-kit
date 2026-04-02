import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft } from 'lucide-react';
import { authService, User } from '../../services/authService';
import { useLanguage } from '../LanguageContext';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

type LoginStep = 'initial' | 'verification';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: User) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLogin }) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<LoginStep>('initial');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('initial');
      setEmail('');
      setVerificationCode('');
      setError(null);
      setIsGoogleLoading(false);
      setIsEmailLoading(false);
    }
  }, [isOpen]);

  // Lower sidebar z-index when modal is open so modal covers it
  useEffect(() => {
    if (isOpen) {
      const style = document.createElement('style');
      style.id = 'login-modal-sidebar-fix';
      style.textContent = `
        [data-testid="bnbot-sidebar"] {
          z-index: 0 !important;
        }
        [data-testid="bnbot-sidebar"] * {
          z-index: 0 !important;
        }
      `;
      const shadowContainer = document.getElementById('x-sidekick-container');
      const target = shadowContainer?.shadowRoot || document.head;
      target.appendChild(style);

      return () => {
        const existing = (shadowContainer?.shadowRoot || document.head).querySelector('#login-modal-sidebar-fix');
        existing?.remove();
      };
    }
  }, [isOpen]);

  // Focus code input when entering verification step
  useEffect(() => {
    if (step === 'verification' && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [step]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setError(null);
    try {
      const user = await authService.googleLogin();
      onLogin(user);
    } catch (err) {
      console.error('Google login error:', err);
      setError(err instanceof Error ? err.message : 'Google login failed');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsEmailLoading(true);
    setError(null);
    try {
      const success = await authService.sendVerificationCode(email.trim());
      if (success) {
        setStep('verification');
        setCountdown(60);
      } else {
        setError('Failed to send verification code. Please try again.');
      }
    } catch (err) {
      console.error('Error sending code:', err);
      setError('Failed to send verification code. Please try again.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verificationCode.length !== 6) return;
    setIsEmailLoading(true);
    setError(null);
    try {
      const user = await authService.verifyCode(email.trim(), verificationCode);
      onLogin(user);
    } catch (err) {
      console.error('Error verifying code:', err);
      setError(err instanceof Error ? err.message : 'Invalid verification code');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    setIsEmailLoading(true);
    setError(null);
    try {
      await authService.sendVerificationCode(email.trim());
      setCountdown(60);
    } catch (err) {
      console.error('Error resending code:', err);
      setCountdown(60);
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleBack = () => {
    setStep('initial');
    setVerificationCode('');
    setError(null);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      onClick={handleOverlayClick}
      className="flex items-center justify-center p-4"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '486px',
        height: '100vh',
        zIndex: 9999,
        pointerEvents: 'auto',
        backgroundColor: 'rgba(128, 128, 128, 0.25)',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '360px',
          position: 'relative',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Close button */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>

        {step === 'verification' ? (
          /* Verification Step */
          <div style={{ padding: '32px 24px 28px' }}>
            {/* Back button */}
            <button
              onClick={handleBack}
              style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
            </button>

            <h2 style={{
              fontSize: '20px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '8px',
              textAlign: 'center',
            }}>
              {t.login.enterVerificationCode}
            </h2>

            <p style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              marginBottom: '24px',
              textAlign: 'center',
            }}>
              {t.login.codeSentTo}{' '}
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{email}</span>
            </p>

            {error && (
              <p style={{
                fontSize: '13px',
                color: '#ef4444',
                marginBottom: '12px',
                textAlign: 'center',
              }}>
                {error}
              </p>
            )}

            <form onSubmit={handleVerifyCode}>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                placeholder={t.login.digitCode}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '2px solid var(--accent-color)',
                  borderRadius: '9999px',
                  fontSize: '16px',
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                  letterSpacing: '6px',
                  outline: 'none',
                  marginBottom: '12px',
                  boxSizing: 'border-box',
                }}
              />

              <button
                type="submit"
                disabled={verificationCode.length !== 6 || isEmailLoading}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: verificationCode.length === 6 ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: verificationCode.length === 6 ? '#111827' : 'var(--text-secondary)',
                  cursor: (verificationCode.length !== 6 || isEmailLoading) ? 'not-allowed' : 'pointer',
                  opacity: isEmailLoading ? 0.7 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {isEmailLoading ? t.login.verifying : t.common.signIn}
              </button>
            </form>

            <p style={{
              marginTop: '16px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}>
              {t.login.didntGetEmail}{' '}
              <button
                onClick={handleResendCode}
                disabled={countdown > 0 || isEmailLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: countdown > 0 ? 'var(--text-secondary)' : 'var(--text-primary)',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  cursor: countdown > 0 ? 'not-allowed' : 'pointer',
                  padding: 0,
                  fontSize: '12px',
                }}
              >
                {countdown > 0 ? `${t.login.resend} (${countdown}s)` : t.login.resend}
              </button>
            </p>
          </div>
        ) : (
          /* Initial Login Step */
          <div style={{ padding: '32px 24px 28px' }}>
            <h2 style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '6px',
              textAlign: 'center',
            }}>
              {t.login.title}
            </h2>

            <p style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              marginBottom: '24px',
              textAlign: 'center',
            }}>
              {t.login.subtitle}
            </p>

            {error && (
              <p style={{
                fontSize: '13px',
                color: '#ef4444',
                marginBottom: '12px',
                textAlign: 'center',
              }}>
                {error}
              </p>
            )}

            {/* Google Login */}
            <button
              onClick={handleGoogleLogin}
              disabled={isGoogleLoading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                padding: '12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '9999px',
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--text-primary)',
                cursor: isGoogleLoading ? 'not-allowed' : 'pointer',
                opacity: isGoogleLoading ? 0.7 : 1,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isGoogleLoading) e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-primary)';
              }}
            >
              <GoogleIcon />
              <span>{isGoogleLoading ? t.login.signingIn : t.login.continueWithGoogle}</span>
            </button>

            {/* Divider */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              margin: '20px 0',
            }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
              <span style={{ padding: '0 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {t.common.or}
              </span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
            </div>

            {/* Email Login */}
            <form onSubmit={handleSendCode}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.login.enterEmail}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  marginBottom: '12px',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-color)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              />

              <button
                type="submit"
                disabled={!email.trim() || isEmailLoading}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: email.trim() ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: email.trim() ? '#111827' : 'var(--text-secondary)',
                  cursor: (!email.trim() || isEmailLoading) ? 'not-allowed' : 'pointer',
                  opacity: isEmailLoading ? 0.7 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {isEmailLoading ? t.login.sendingCode : t.login.continueWithEmail}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
