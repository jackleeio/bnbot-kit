import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { authService, User } from '../../services/authService';
import { useLanguage } from '../LanguageContext';

// Google Icon Component
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

type LoginStep = 'initial' | 'verification';

interface LoginPanelProps {
  onClose?: () => void;
  onLogin?: (user: User) => void;
}

export const LoginPanel: React.FC<LoginPanelProps> = ({ onClose, onLogin }) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<LoginStep>('initial');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  const codeInputRef = useRef<HTMLInputElement>(null);

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

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setError(null);

    try {
      const user = await authService.googleLogin();
      onLogin?.(user);
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
      onLogin?.(user);
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

  // Verification Code Step
  if (step === 'verification') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '32px',
        backgroundColor: 'transparent',
        position: 'relative',
      }}>
        {/* Back Button */}
        <button
          onClick={handleBack}
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-primary)',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>

        {/* Title */}
        <h1 style={{
          fontSize: '24px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: '12px',
        }}>
          {t.login.enterVerificationCode}
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '32px',
          textAlign: 'center',
        }}>
          {t.login.codeSentTo} <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{email}</span>
        </p>

        {/* Error Message */}
        {error && (
          <p style={{
            fontSize: '14px',
            color: '#ef4444',
            marginBottom: '16px',
            textAlign: 'center',
          }}>
            {error}
          </p>
        )}

        {/* Code Input */}
        <form onSubmit={handleVerifyCode} style={{ width: '100%', maxWidth: '320px' }}>
          <input
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={verificationCode}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              setVerificationCode(value);
            }}
            placeholder={t.login.digitCode}
            className="verification-code-input"
            style={{
              width: '100%',
              padding: '16px 24px',
              backgroundColor: 'var(--bg-primary)',
              border: '2px solid var(--accent-color)',
              borderRadius: '9999px',
              fontSize: '16px',
              color: 'var(--text-primary)',
              textAlign: 'center',
              letterSpacing: '8px',
              outline: 'none',
              marginBottom: '16px',
            }}
          />

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={verificationCode.length !== 6 || isEmailLoading}
            style={{
              width: '100%',
              padding: '16px 24px',
              backgroundColor: verificationCode.length === 6 ? 'var(--accent-color)' : 'var(--bg-secondary)',
              border: 'none',
              borderRadius: '9999px',
              fontSize: '16px',
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

        {/* Resend Link */}
        <p style={{
          marginTop: '24px',
          fontSize: '14px',
          color: '#6b7280',
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
            }}
          >
            {countdown > 0 ? `${t.login.resend} (${countdown}s)` : t.login.resend}
          </button>
        </p>
      </div>
    );
  }

  // Initial Login Step
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '32px',
      backgroundColor: 'var(--bg-primary)',
    }}>
      {/* Title */}
      <h1 style={{
        fontSize: '28px',
        fontWeight: 700,
        color: 'var(--text-primary)',
        marginBottom: '12px',
      }}>
        {t.login.title}
      </h1>

      {/* Subtitle */}
      <p style={{
        fontSize: '14px',
        color: 'var(--text-secondary)',
        marginBottom: '32px',
        textAlign: 'center',
      }}>
        {t.login.subtitle}
      </p>

      {/* Error Message */}
      {error && (
        <p style={{
          fontSize: '14px',
          color: '#ef4444',
          marginBottom: '16px',
          textAlign: 'center',
          maxWidth: '320px',
        }}>
          {error}
        </p>
      )}

      {/* Google Login Button */}
      <button
        onClick={handleGoogleLogin}
        disabled={isGoogleLoading}
        style={{
          width: '100%',
          maxWidth: '320px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '14px 24px',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '9999px',
          fontSize: '15px',
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
        width: '100%',
        maxWidth: '320px',
        margin: '24px 0',
      }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
        <span style={{ padding: '0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t.common.or}</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
      </div>

      {/* Email Input */}
      <form onSubmit={handleSendCode} style={{ width: '100%', maxWidth: '320px' }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.login.enterEmail}
          style={{
            width: '100%',
            padding: '14px 20px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '9999px',
            fontSize: '15px',
            color: 'var(--text-primary)',
            outline: 'none',
            marginBottom: '16px',
            textAlign: 'center',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-color)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-color)';
          }}
        />

        {/* Continue Button */}
        <button
          type="submit"
          disabled={!email.trim() || isEmailLoading}
          style={{
            width: '100%',
            padding: '14px 24px',
            backgroundColor: email.trim() ? 'var(--accent-color)' : 'var(--bg-secondary)',
            border: 'none',
            borderRadius: '9999px',
            fontSize: '15px',
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
  );
};
