import { Suspense } from 'react';
import cn from '@/utils/cn';
import XIDListCard from '@/components/ui/xid-list-card';
import ListCard from '@/components/ui/list-card';
import ParamTab, { TabPanel } from '@/components/ui/param-tab';
import TransactionSearchForm from '@/components/author/transaction-search-form';
import TransactionHistory from '@/components/author/transaction-history';
import CollectionCard from '@/components/ui/collection-card';
import { useLayout } from '@/lib/hooks/use-layout';
import { LAYOUT_OPTIONS } from '@/lib/constants';
// static data
import { collections } from '@/data/static/collections';

import Wallet from '@/assets/images/portfolio/wallet.svg';
import Nft from '@/assets/images/portfolio/nft.svg';
import Deposit from '@/assets/images/portfolio/deposit.svg';
import Claimable from '@/assets/images/portfolio/claimable.svg';
import Curve from '@/assets/images/portfolio/curve.svg';
import PooltoGether from '@/assets/images/portfolio/poolto-gether.svg';
import Uniswap from '@/assets/images/portfolio/uniswap.svg';
import Pancake from '@/assets/images/portfolio/pancake.svg';
import Bitcoin from '@/assets/images/currency/bitcoin.svg';
import Ethereum from '@/assets/images/currency/ethereum.svg';

import {
  authorWallets,
  authorNetworks,
  authorProtocols,
} from '@/data/static/author-profile';
import Loader from '@/components/ui/loader';

const tabMenu = [
  {
    title: 'Portfolio',
    path: 'portfolio',
  },
];

export default function ProfileTab() {
  const { layout } = useLayout();
  const assets = [
    {
      id: 1,
      name: 'BTC',
      logo: Bitcoin,
      balance: '$2,518.78',
    },
    {
      id: 2,
      name: 'ETH',
      logo: Ethereum,
      balance: '$152.00',
    },
    {
      id: 1,
      name: 'POOLTOGETHER',
      logo: PooltoGether,
      balance: '$2,215.43',
    },
    {
      id: 2,
      name: 'FansCoin',
      logo: Curve,
      balance: '$2,215.43',
    },
  ];
  const otherFuncs = [
    {
      id: 1,
      name: 'Batch Transfer',
      logo: Wallet,
    },
    {
      id: 2,
      name: 'Etherscan',
      logo: Nft,
    },
    {
      id: 3,
      name: 'Change Address',
      logo: Deposit,
    },
    {
      id: 4,
      name: 'Get Airdrop',
      logo: Claimable,
    },
  ];

  return (
    <Suspense fallback={<Loader variant="blink" />}>
      <ParamTab tabMenu={tabMenu}>
        <TabPanel className="focus:outline-none">
          <div className="space-y-8 md:space-y-10 xl:space-y-12">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-2 3xl:grid-cols-2">
              {otherFuncs?.map((item) => (
                <ListCard
                  item={item}
                  key={`wallet-key-${item?.id}`}
                  variant="medium"
                />
              ))}
            </div>
          </div>
        </TabPanel>
      </ParamTab>
    </Suspense>
  );
}
