'use client';

import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Button from '@/components/ui/button';
import { ApolloClient, InMemoryCache, useQuery, gql, HttpLink } from '@apollo/client';
import { formatUnits } from 'viem';
import ethIcon from '@/assets/images/logo-eth-white.png';
import defaultTokenIcon from '@/assets/images/logo-eth-white.png';
import XVaultABI from '@/contracts/XVault';
import { BaseError } from 'wagmi';
import {
  ArrowTopRightOnSquareIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { useNotification } from '@/context/notification-context';

interface User {
  id: string;
  username: string;
  name: string;
  avatar: string;
  email?: string;
}

// TODO: 1.加上获取当前用户数据 2. 调用claim合约 3. 通过Uniswap获取价格
interface VaultBalance {
  id: string;
  username: string;
  token: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  amount: string;
  lastUpdatedAt: string;
}

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  balance: string;
  icon: string;
  price: number;
}

const GET_USER_BALANCES = gql`
  query GetUserBalances($username: String!) {
    vaultBalances(where: { username: $username }) {
      id
      username
      token
      tokenName
      tokenSymbol
      tokenDecimals
      amount
      lastUpdatedAt
    }
  }
`;

const client = new ApolloClient({
  link: new HttpLink({
    uri: process.env.NEXT_PUBLIC_XMONEY_GRAPHQL_ENDPOINT || 'https://api.studio.thegraph.com/query/78663/xmoney/v0.0.6',
  }),
  cache: new InMemoryCache(),
});

console.log(
  'GraphQL Endpoint:',
  process.env.NEXT_PUBLIC_XMONEY_GRAPHQL_ENDPOINT,
);

const getTokenIcon = (symbol: string, address: string) => {
  // ETH specific case
  if (symbol.toLowerCase() === 'eth' || symbol.toLowerCase() === 'weth') {
    return ethIcon;
  }

  // For all other tokens, use default icon
  return defaultTokenIcon;
};

interface Props {
  userData: User | null;
  xidAddress: `0x${string}` | undefined;
  loading: boolean;
}

const TokenBalanceTable = ({ userData, xidAddress, loading }: Props) => {
  // const { address } = useAccount();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [claimingTokens, setClaimingTokens] = useState<Set<string>>(new Set());
  const [claimAllPending, setClaimAllPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const {
    writeContract,
    data: txData,
    error: txError,
    status: txStatus,
    isPending,
  } = useWriteContract();
  const { showNotification } = useNotification();

  const username = userData?.email || '';
  const address = xidAddress || null;

  // 监听交易状态
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txData,
  });

  console.log('userData', userData);

  console.log('username', username);
  const {
    loading: balanceLoading,
    error,
    data,
  } = useQuery(GET_USER_BALANCES, {
    variables: { username: username?.toLowerCase() },
    client,
    skip: !username,
  });

  console.log('data', data);

  const fetchTokenPrices = async (formattedTokens: TokenInfo[]) => {
    setIsLoadingPrices(true);
    try {
      const addresses = formattedTokens
        .map((token) => token.address.toLowerCase())
        .join(',');
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${addresses}&vs_currencies=usd`,
      );
      const priceData = await response.json();

      return formattedTokens.map((token) => ({
        ...token,
        price: priceData[token.address.toLowerCase()]?.usd || 0,
      }));
    } catch (error) {
      console.error('Error fetching token prices:', error);
      return formattedTokens;
    } finally {
      setIsLoadingPrices(false);
    }
  };

  useEffect(() => {
    if (data?.vaultBalances) {
      const formattedTokens: TokenInfo[] = data.vaultBalances.map(
        (balance: VaultBalance) => ({
          address: balance.token,
          name: balance.tokenName,
          symbol: balance.tokenSymbol,
          balance: formatUnits(BigInt(balance.amount), balance.tokenDecimals),
          icon: getTokenIcon(balance.tokenSymbol, balance.token),
          price: 0,
        }),
      );

      // Fetch prices for all tokens
      fetchTokenPrices(formattedTokens).then((tokensWithPrices) => {
        setTokens(tokensWithPrices);
      });
    }
  }, [data]);

  const totalValue = tokens.reduce((sum, token) => {
    return sum + parseFloat(token.balance.replace(',', '')) * token.price;
  }, 0);

  const handleClaimAll = async () => {
    if (!username || !address) return;

    if (!xidAddress) {
      showNotification({
        msg: 'Please create your XID first to claim tokens',
        type: 'warning',
        title: 'XID Required',
        icon: <ExclamationCircleIcon className="h-6 w-6 text-yellow-400" />,
      });
      return;
    }

    setClaimAllPending(true);

    try {
      await writeContract({
        address: process.env
          .NEXT_PUBLIC_XVAULT_CONTRACT_ADDRESS as `0x${string}`,
        abi: XVaultABI,
        functionName: 'withdrawAll',
        args: [username.toLowerCase()],
      });
    } catch (error) {
      console.error('Detailed error:', error);
      setClaimAllPending(false);

      let errorMessage = 'Failed to claim all tokens';
      let errorDetails = '';

      if (error instanceof BaseError) {
        console.log('Error type:', error.constructor.name);
        console.log('Error message:', error.message);

        // 添加错误详情
        errorDetails = `\n\nDetails: ${error.message}`;

        if (error.message.includes('User rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error.message.includes('Not the XID owner')) {
          errorMessage = 'You are not the owner of this XID username';
        } else if (error.message.includes('insufficient funds')) {
          errorMessage = 'Insufficient funds for gas';
        } else if (error.message.includes('execution reverted')) {
          const revertReason = error.message.match(
            /execution reverted: (.*?)(?:\.|$)/,
          )?.[1];
          errorMessage = revertReason || 'No tokens available to claim';
        }
      }

      showNotification({
        msg: errorMessage + errorDetails,
        type: 'error',
        title: 'Transaction Failed',
      });
    }
  };

  const handleClaim = async (token: TokenInfo) => {
    if (!username || !address) return;

    if (!xidAddress) {
      showNotification({
        msg: 'Please create your XID first to claim tokens',
        type: 'warning',
        title: 'XID Required',
        icon: <ExclamationCircleIcon className="h-6 w-6 text-yellow-400" />,
      });
      return;
    }

    try {
      setClaimingTokens((prev) => new Set(prev).add(token.address));
      const isEthToken =
        token.symbol.toLowerCase() === 'eth' ||
        token.symbol.toLowerCase() === 'weth';

      if (isEthToken) {
        await writeContract({
          address: process.env
            .NEXT_PUBLIC_XVAULT_CONTRACT_ADDRESS as `0x${string}`,
          abi: XVaultABI,
          functionName: 'withdrawEth',
          args: [username.toLowerCase()],
        });
      } else {
        await writeContract({
          address: process.env
            .NEXT_PUBLIC_XVAULT_CONTRACT_ADDRESS as `0x${string}`,
          abi: XVaultABI,
          functionName: 'withdrawToken',
          args: [username.toLowerCase(), token.address as `0x${string}`],
        });
      }
    } catch (error) {
      console.error('Detailed error:', error);
      setClaimingTokens((prev) => {
        const newSet = new Set(prev);
        newSet.delete(token.address);
        return newSet;
      });

      let errorMessage = `Failed to claim ${token.symbol}`;
      let errorDetails = '';

      if (error instanceof BaseError) {
        console.log('Error type:', error.constructor.name);
        console.log('Error message:', error.message);

        // 添加错误详情
        errorDetails = `\n\nDetails: ${error.message}`;

        if (error.message.includes('User rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error.message.includes('Not the XID owner')) {
          errorMessage = 'You are not the owner of this XID username';
        } else if (error.message.includes('insufficient funds')) {
          errorMessage = 'Insufficient funds for gas';
        } else if (error.message.includes('execution reverted')) {
          const revertReason = error.message.match(
            /execution reverted: (.*?)(?:\.|$)/,
          )?.[1];
          errorMessage = revertReason || `No ${token.symbol} balance available`;
        }
      }

      showNotification({
        msg: errorMessage + errorDetails,
        type: 'error',
        title: 'Transaction Failed',
      });
    }
  };

  // 监听交易状态
  useEffect(() => {
    if (txStatus === 'error') {
      setTxHash(null);
      setClaimingTokens(new Set());
      setClaimAllPending(false);

      let errorMessage = 'Error in transaction';
      let errorDetails = '';
      console.log(txError);
      if (txError instanceof BaseError) {
        if (txError.message.includes('User rejected')) {
          errorMessage = 'User rejected the request';
          errorDetails = `\n\nDetails: MetaMask Tx Signature: User denied transaction signature.`;
        } else if (txError.message.includes('insufficient funds')) {
          errorMessage = 'Insufficient funds for gas';
          errorDetails = `\n\nDetails: ${txError.message}`;
        } else if (txError.message.includes('execution reverted')) {
          const revertReason = txError.message.match(
            /execution reverted: (.*?)(?:\.|$)/,
          )?.[1];
          errorMessage = revertReason || 'Transaction reverted by contract';
          errorDetails = `\n\nDetails: ${txError.message}`;
        } else {
          errorMessage = txError.shortMessage || txError.message;
          errorDetails = `\n\nDetails: ${txError.message}`;
        }
      }

      showNotification({
        msg: errorMessage + errorDetails,
        type: 'error',
        title: 'Transaction Failed',
      });
    } else if (txStatus === 'success') {
      if (txData) {
        setTxHash(txData);
        setClaimAllPending(false);
        setClaimingTokens(new Set());
        showNotification({
          msg: 'Transaction submitted successfully',
          type: 'success',
          title: 'Claim Success',
        });
      }
    }
  }, [txStatus, txError, txData, showNotification]);

  // 监听交易确认状态
  useEffect(() => {
    if (isConfirming) {
      showNotification({
        msg: 'Waiting for transaction confirmation...',
        type: 'warning',
        title: 'Transaction Pending',
      });
    } else if (isSuccess) {
      showNotification({
        msg: 'Transaction confirmed successfully',
        type: 'success',
        title: 'Transaction Confirmed',
      });
    }
  }, [isConfirming, isSuccess, showNotification]);

  if (loading || isLoadingPrices || balanceLoading) {
    return (
      <div className="mb-8 rounded-3xl bg-white p-8 shadow">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-1/4 rounded bg-gray-200"></div>
          <div className="space-y-3">
            <div className="h-6 rounded bg-gray-200"></div>
            <div className="h-6 rounded bg-gray-200"></div>
            <div className="h-6 rounded bg-gray-200"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <div>Error loading token balances: {error.message}</div>;
  }

  return (
    <div className="mb-8 overflow-hidden rounded-3xl bg-white shadow">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">
            Token Balance in Your X Account
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Total Value:{' '}
            <span className="font-medium">
              $
              {totalValue.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
            </span>
          </p>
        </div>
        {tokens.length > 0 && (
          <Button
            onClick={handleClaimAll}
            disabled={!address || isPending || claimAllPending}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-3xl bg-black font-medium text-white hover:bg-gray-800"
          >
            {isPending && claimAllPending && (
              <span className="loading loading-spinner loading-sm relative top-[3px]"></span>
            )}
            <span className="relative pl-2">
              {!address
                ? 'Claim All'
                : isPending && claimAllPending
                  ? 'Waiting Confirm...'
                  : 'Claim All'}
            </span>
          </Button>
        )}
      </div>
      <div className={`${tokens.length > 0 ? 'overflow-x-auto' : ''}`}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-16"></th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Token
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Balance
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Price
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Value
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Address
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {tokens.length > 0 ? (
              tokens.map((token, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap py-4 pl-6">
                    <div className="h-10 w-10 flex-shrink-0">
                      <Image
                        src={token.icon}
                        alt={token.symbol}
                        width={50}
                        height={50}
                        className="rounded-full bg-gray-100 p-0.5"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.onerror = null;
                          target.src = defaultTokenIcon.src;
                        }}
                      />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center">
                    <div className="text-sm font-medium text-gray-900">
                      {token.name}
                    </div>
                    <div className="text-xs text-gray-500">{token.symbol}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500">
                    {token.balance}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500">
                    $
                    {token.price.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500">
                    $
                    {(
                      parseFloat(token.balance.replace(',', '')) * token.price
                    ).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center text-sm text-gray-500">
                    {!token.symbol.toLowerCase().includes('eth') && (
                      <span className="font-mono">
                        {`${token.address.slice(0, 6)}...${token.address.slice(-4)}`}
                      </span>
                    )}
                    {token.symbol.toLowerCase().includes('eth') && (
                      <span className="flex justify-center italic text-gray-400">
                        -
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center text-sm">
                    <Button
                      onClick={() => handleClaim(token)}
                      disabled={
                        !address ||
                        isPending ||
                        claimingTokens.has(token.address)
                      }
                      size="small"
                      className="rounded-3xl bg-black px-4 py-1 text-xs text-white hover:bg-gray-800"
                    >
                      Claim
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-4 text-center text-sm text-gray-500"
                >
                  No token balances available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TokenBalanceTable;
