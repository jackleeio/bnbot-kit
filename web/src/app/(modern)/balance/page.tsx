'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { useRouter } from 'next/navigation';
import Image from '@/components/ui/image';
import EthBrand from '@/assets/images/eth-brand-5.avif';
import XIDProfile from '@/components/profile/xid-profile';
import TokenBalanceTable from '@/components/profile/token-balance-table';
import xidABI from '@/contracts/XID';
import { useAuth } from '@/lib/hooks/useAuth';

interface User {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

const AuthorProfilePageRetro = () => {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const [userData, setUserData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Contract read for XID address lookup

  console.log('userData', userData?.email?.toLowerCase());
  console.log('start reading contract');
  const { data: xidAddress, isError } = useReadContract({
    address: process.env.NEXT_PUBLIC_XID_ADDRESS as `0x${string}`,
    abi: xidABI,
    functionName: 'getAddressByUsername',
    args: userData?.email ? [userData.email.toLowerCase()] : undefined,
  });

  useEffect(() => {
    // 只从 localStorage 读取 userData
    const storedUserData = localStorage.getItem('userData.bnbot');

    if (storedUserData) {
      try {
        setUserData(JSON.parse(storedUserData));
      } catch (error) {
        console.error('Error parsing user data:', error);
        setUserData(null);
      }
    } else if (!isLoggedIn) {
      // 如果未登录，重定向到登录页
      router.push('/login');
    }

    setIsLoading(false);
  }, [router, isLoggedIn]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 3xl:px-10">
      {/* Profile Card */}
      <div className="m-auto w-full rounded-3xl text-center shadow-lg md:w-1/2">
        <div className="relative h-48 w-full overflow-hidden rounded-3xl sm:h-32 md:h-48 xl:h-64 2xl:h-72 3xl:h-80">
          <Image
            src={EthBrand}
            placeholder="blur"
            priority
            quality={100}
            className="h-full w-full object-cover"
            alt="Cover Image"
            draggable="false"
          />
        </div>
        <div className="mx-auto flex w-full shrink-0 flex-col md:px-4 xl:px-6 3xl:max-w-[1700px] 3xl:px-12">
          <XIDProfile
            userData={userData}
            xidAddress={xidAddress as `0x${string}`}
            loading={isLoading}
          />
        </div>
      </div>

      {/* Token Balance Table */}
      <div className="mx-auto mt-8 w-full md:w-3/4">
        <TokenBalanceTable
          userData={userData}
          xidAddress={xidAddress as `0x${string}`}
          loading={isLoading}
        />
      </div>
    </div>
  );
};

export default AuthorProfilePageRetro;
