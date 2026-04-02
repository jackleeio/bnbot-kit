'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LoginModal from '@/components/login/login-modal';

function RegisterContent() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get('code') || searchParams.get('invite_code');

  const [isRedirecting, setIsRedirecting] = useState(false);
  const redirectTimerRef = useState<{ current: NodeJS.Timeout | null }>({ current: null })[0];

  useEffect(() => {
    if (!inviteCode) {
      router.push('/');
      return;
    }

    // Store the invitation code in localStorage
    localStorage.setItem('invite_code', inviteCode);
    console.log('Invitation code stored:', inviteCode);

    // Open modal automatically
    setIsModalOpen(true);
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, [inviteCode, router]);

  const handleClose = () => {
    setIsModalOpen(false);
    setIsRedirecting(true);

    // Delay redirect to allow user to re-open if accidental
    redirectTimerRef.current = setTimeout(() => {
      router.push('/');
    }, 5000);
  };

  const handleLoginSuccess = () => {
    // Clear invite code after successful login
    localStorage.removeItem('invite_code');
    // Redirect to agent page
    window.location.href = '/agent';
  };

  const handleReopen = () => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    setIsRedirecting(false);
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center p-8">
        <h1 className="text-2xl font-bold mb-4">Join BNBOT</h1>
        {inviteCode && (
          <p className="mb-6 font-medium" style={{ color: '#f0b90b' }}>
            You've been invited! Sign in to claim your reward.
          </p>
        )}
        
        {isRedirecting && (
          <p className="text-gray-500 mb-4 text-sm animate-pulse">
            Redirecting to home in a few seconds...
          </p>
        )}

        <button
          onClick={handleReopen}
          className="px-6 py-3 bg-black text-white rounded-full font-medium hover:bg-gray-800 transition-colors"
        >
          Sign In / Register
        </button>
      </div>
      
      <LoginModal
        isOpen={isModalOpen}
        onClose={handleClose}
        onLoginSuccess={handleLoginSuccess}
        showInviteCode={true}
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <RegisterContent />
    </Suspense>
  );
}
