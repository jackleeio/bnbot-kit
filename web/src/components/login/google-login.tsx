'use client';

import { useEffect, useState } from 'react';
import { GoogleIcon } from '@/components/icons/google';
import { apiClient } from '@/lib/api-client';

interface GoogleLoginProps {
  btnClassName?: string;
  anchorClassName?: string;
  fromUrl?: string;
}

const GoogleLogin: React.FC<GoogleLoginProps> = ({ btnClassName, fromUrl = 'balance' }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.get<{ authUrl: string }>(
        `/api/v1/google-auth/initiate?fromUrl=${encodeURIComponent(fromUrl)}`
      );

      if (response.authUrl) {
        window.location.href = response.authUrl;
      } else {
        throw new Error('No auth URL received');
      }
    } catch (error) {
      console.error('Error initiating Google login:', error);
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <button
          className="btn btn-circle btn-outline btn-block text-[#f0b90b] transform text-lg font-medium transition-transform duration-200 hover:scale-105 hover:bg-[#f0b90b] hover:text-black hover:border-[#f0b90b] disabled:bg-slate-100 disabled:text-slate-400"
          onClick={handleGoogleLogin}
          disabled={isLoading}
        >
          {isLoading && <span className="loading loading-spinner"></span>}
          {isLoading ? (
            'Connecting...'
          ) : (
            <div className="flex items-center gap-2">
              Login with <GoogleIcon className="h-5 w-5" />
            </div>
          )}
        </button>
      </div>
    </>
  );
};

export default GoogleLogin;