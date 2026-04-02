'use client';

// import { useWeb3Modal } from '@web3modal/wagmi/react';
import { useAppKit } from '@reown/appkit/react'
import { useAccount, useBalance, useDisconnect } from 'wagmi';
import cn from '@/utils/cn';
import Button from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { Transition } from '@/components/ui/transition';
import ActiveLink from '@/components/ui/links/active-link';
import { ChevronForward } from '@/components/icons/chevron-forward';
import { PowerIcon } from '@/components/icons/power';
import ethLogo from '@/assets/images/logo-eth-color.png';

export default function WalletLogin({
  btnClassName,
  anchorClassName,
}: {
  btnClassName?: string;
  anchorClassName?: string;
}) {
  const { address } = useAccount();
  // const { open } = useWeb3Modal();
  const { open } = useAppKit();
  const { data } = useBalance({
    address,
  });
  const { disconnect } = useDisconnect();
  const balance = data?.formatted;

  return (
    <button
      className={cn('btn btn-outline btn-block hover:bg-black ', btnClassName)}
      onClick={() => open()}
    >
      Login With Wallet
    </button>
  );
}
