'use client';

import { useEffect, useState } from 'react';

interface XConnectProps {
  btnClassName?: string;
  anchorClassName?: string;
  fromUrl?: string;
}

const XLogin: React.FC<XConnectProps> = ({ btnClassName, fromUrl = 'balance' }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleTwitterLogin = async () => {
    setIsLoading(true);
    try {
      const url = new URL(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x-auth/initiate`,
      );
      url.searchParams.append('fromUrl', fromUrl);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to initiate Twitter login');
      }

      const data = await response.json();

      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        throw new Error('No auth URL received');
      }
    } catch (error) {
      console.error('Error initiating Twitter login:', error);
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <button
          className="btn btn-circle btn-outline btn-block text-[#f0b90b] transform text-lg font-medium transition-transform duration-200 hover:scale-105 hover:bg-[#f0b90b] hover:text-black hover:border-[#f0b90b] disabled:bg-slate-100 disabled:text-slate-400"
          onClick={handleTwitterLogin}
          disabled={isLoading}
        >
          {isLoading && <span className="loading loading-spinner"></span>}
          {isLoading ? (
            'Connecting...'
          ) : (
            <>
              Login with <span className="ml-0.5">𝕏</span>
            </>
          )}
        </button>
      </div>
    </>
  );
};

export default XLogin;
