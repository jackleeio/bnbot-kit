import React from 'react';
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { CryptoToken } from '../../types';

// Generate some fake chart data
const generateData = (start: number, volatility: number) => {
  const data = [];
  let current = start;
  for (let i = 0; i < 20; i++) {
    current = current * (1 + (Math.random() * volatility - volatility / 2));
    data.push({
      time: `${i}h`,
      value: current
    });
  }
  return data;
};

const MOCK_TOKENS: CryptoToken[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    price: 64230.50,
    change24h: 2.4,
    data: generateData(63000, 0.02)
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    price: 3450.12,
    change24h: -1.2,
    data: generateData(3500, 0.03)
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    price: 145.80,
    change24h: 5.7,
    data: generateData(138, 0.05)
  }
];

export const CryptoPanel: React.FC = () => {
  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="overflow-y-auto p-4 pt-10 space-y-4 pb-20">
        {MOCK_TOKENS.map((token) => (
          <div key={token.symbol} className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-[var(--text-primary)] font-bold text-lg tracking-tight">{token.symbol}</h3>
                  <span className="text-[var(--text-secondary)] text-xs font-medium">{token.name}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-mono text-[var(--text-primary)] tracking-tighter">
                    ${token.price.toLocaleString()}
                  </span>
                  <span className={`flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    token.change24h >= 0
                      ? 'bg-green-100 text-green-600'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    {token.change24h >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {Math.abs(token.change24h)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="h-28 w-full -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={token.data}>
                  <defs>
                    <linearGradient id={`color${token.symbol}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={token.change24h >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0.2}/>
                      <stop offset="95%" stopColor={token.change24h >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#333', borderRadius: '8px', fontSize: '12px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    cursor={{ stroke: '#6b7280', strokeDasharray: '4 4' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke={token.change24h >= 0 ? "#22c55e" : "#ef4444"} 
                    fillOpacity={1} 
                    fill={`url(#color${token.symbol})`} 
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};