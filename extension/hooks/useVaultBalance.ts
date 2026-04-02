import { useState, useEffect } from 'react';

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

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  balance: string;
  decimals: number;
}

const GRAPHQL_ENDPOINT = import.meta.env.VITE_XMONEY_GRAPHQL_ENDPOINT || '';
const GRAPHQL_API_KEY = import.meta.env.VITE_GRAPHQL_API_KEY || '';

const GET_USER_BALANCES_QUERY = `
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

function formatUnits(value: bigint, decimals: number): string {
  const str = value.toString();
  if (decimals === 0) return str;
  const padded = str.padStart(decimals + 1, '0');
  const integerPart = padded.slice(0, -decimals);
  const decimalPart = padded.slice(-decimals).replace(/0+$/, '');
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}

async function fetchVaultBalances(username: string): Promise<VaultBalance[]> {
  if (!GRAPHQL_ENDPOINT) return [];

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GRAPHQL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: GET_USER_BALANCES_QUERY,
      variables: { username: username.toLowerCase() },
    }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { data } = await response.json();
  return data?.vaultBalances || [];
}

export function useVaultBalance(username: string | null) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchBalances = async () => {
    if (!username || !GRAPHQL_ENDPOINT) {
      setTokens([]);
      setHasFetched(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const balances = await fetchVaultBalances(username);
      const formattedTokens: TokenInfo[] = balances.map(
        (balance: VaultBalance) => ({
          address: balance.token,
          name: balance.tokenName,
          symbol: balance.tokenSymbol,
          balance: formatUnits(BigInt(balance.amount), balance.tokenDecimals),
          decimals: balance.tokenDecimals,
        })
      );
      setTokens(formattedTokens);
    } catch (err) {
      setError(err as Error);
      console.error('Error fetching vault balances:', err);
    } finally {
      setIsLoading(false);
      setHasFetched(true);
    }
  };

  useEffect(() => {
    fetchBalances();
  }, [username]);

  const showLoading = isLoading || (!!username && !hasFetched);

  return { tokens, isLoading: showLoading, error, refetch: fetchBalances };
}
