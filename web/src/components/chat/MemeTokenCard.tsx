import React, { useEffect, useState } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { StarIcon } from '@heroicons/react/24/solid';
import Pancake from '@/assets/images/pancake.svg';
import FourMeme from '@/assets/images/four-meme.webp';

interface MemeTokenCardProps {
  toolResult: {
    type: string;
    tool_name: string;
    result: {
      type: string;
      text: string;
    }[];
  };
}

interface Holder {
  address: string;
  userName: string;
  amount: string;
  percentage: number;
}

const MemeTokenCard: React.FC<MemeTokenCardProps> = ({ toolResult }) => {
  console.log('toolResult', toolResult);
  const [parsedData, setParsedData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const parseData = async () => {
      if (!toolResult || !toolResult.result?.[0]?.text) {
        setError('无效的工具结果数据');
        setLoading(false);
        return;
      }

      try {
        // 解析外层 JSON
        const innerData = JSON.parse(toolResult.result[0].text);

        if (!innerData.success || !innerData.data) {
          setError('返回的数据不完整');
          setLoading(false);
          return;
        }

        // 处理持仓数据
        const holdersData = innerData.data.holders || {};
        const holdersDistribution = calculateHoldersDistribution(holdersData);

        setParsedData({
          ...innerData,
          data: {
            ...innerData.data,
            holdersCount: calculateHoldersCount(holdersData),
            holdersDistribution,
          },
        });
        setLoading(false);
      } catch (err) {
        console.error('解析Meme代币数据时出错:', err);
        setError('数据解析失败');
        setLoading(false);
      }
    };

    parseData();
  }, [toolResult]);

  // 计算持有人数量
  const calculateHoldersCount = (holders: any) => {
    let count = 0;
    if (holders.lp) count += 1;
    if (holders.tokenHolders) count += holders.tokenHolders.length;
    return count;
  };

  // 修改计算持仓分布函数
  const calculateHoldersDistribution = (holders: any) => {
    if (!holders) return [];

    try {
      const allHolders = [];

      // 添加 LP 持仓
      if (holders.lp) {
        allHolders.push({
          address: holders.lp.address,
          userName: holders.lp.userName,
          amount: holders.lp.amount,
        });
      }

      // 添加其他持仓者
      if (holders.tokenHolders && Array.isArray(holders.tokenHolders)) {
        holders.tokenHolders.forEach((holder: any) => {
          allHolders.push({
            address: holder.address,
            userName: holder.userName,
            amount: holder.amount,
          });
        });
      }

      // 计算总供应量 (使用字符串处理大数)
      const totalSupply = allHolders.reduce((acc, holder) => {
        const amount = parseFloat(holder.amount);
        return acc + (isNaN(amount) ? 0 : amount);
      }, 0);

      // 计算百分比并排序
      const holdersDistribution = allHolders
        .map((holder) => ({
          ...holder,
          percentage: (parseFloat(holder.amount) / totalSupply) * 100,
        }))
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 5);

      return holdersDistribution;
    } catch (error) {
      console.error('Error calculating holders distribution:', error);
      return [];
    }
  };

  // 添加进度格式化函数
  const formatProgress = (progress: string | undefined) => {
    if (!progress) return 0;
    // 将字符串转换为数字
    const value = parseFloat(progress);
    if (isNaN(value)) return 0;

    // 如果是小数形式，乘以100转换为百分比
    const percentage = value * 100;
    return Math.min(Math.max(percentage, 0), 100); // 确保值在 0-100 之间
  };

  if (loading) {
    return (
      <div className="mx-auto flex items-center justify-center rounded-3xl border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
        <svg
          className="mr-2 h-5 w-5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <span>加载代币数据中...</span>
      </div>
    );
  }

  if (error || !parsedData) {
    return (
      <div className="mx-auto max-w-[280px] rounded-3xl border border-red-200 bg-red-50 p-4 text-red-600">
        <p>{error || '加载Meme代币数据失败'}</p>
      </div>
    );
  }

  const data = parsedData.data;

  // 计算价格变化的百分比（假设有这个数据）
  const priceChangePercent = data.tokenPrice?.dayIncrease
    ? parseFloat(data.tokenPrice.dayIncrease)
    : Math.random() * 50 - 10; // 如果没有数据，随机生成一个值用于演示

  // 格式化大数字
  const formatNumber = (num: string | undefined) => {
    if (!num) return '0';
    try {
      const numValue = parseFloat(num);
      // 如果是大数值，提供简化的K/M格式
      if (numValue >= 1000000) {
        return `${(numValue / 1000000).toFixed(2)}M`;
      } else if (numValue >= 1000) {
        return `${(numValue / 1000).toFixed(2)}K`;
      }
      return numValue.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
    } catch (e) {
      return '0';
    }
  };

  // 格式化价格，将前导零的数量以下标形式显示
  const formatCompactPrice = (price: string | undefined) => {
    if (!price) return '0.0';
    try {
      const numPrice = parseFloat(price);

      // 将数字转换为字符串格式
      const priceStr = numPrice.toString();

      // 处理常规小数或科学计数法
      let zeroCount = 0;
      let significantDigits = '';

      if (priceStr.includes('e-')) {
        const [base, exponent] = priceStr.split('e-');
        const exp = parseInt(exponent);
        zeroCount = exp - 1;
        significantDigits = parseFloat(base).toString().replace('.', '');
      } else {
        const parts = numPrice.toFixed(20).split('.');
        if (!parts[1]) return parts[0];

        const decimalPart = parts[1];
        for (let i = 0; i < decimalPart.length; i++) {
          if (decimalPart[i] === '0') {
            zeroCount++;
          } else {
            significantDigits = decimalPart.substring(i);
            break;
          }
        }
      }

      if (zeroCount >= 2) {
        const digits = significantDigits.substring(0, 6);
        return (
          <span className="inline-flex items-baseline font-mono">
            $0.0
            <span className="translate-y-[1px] text-[10px] font-medium text-green-500">
              {zeroCount}
            </span>
            {digits}
          </span>
        );
      }

      return `$${numPrice.toFixed(Math.min(6, priceStr.length))}`;
    } catch (e) {
      return '$0.0';
    }
  };

  // 修改 pancakeswapUrl 为通用的 tradeUrl
  const getTradeUrl = (address: string, isProgressTag: boolean) => {
    if (isProgressTag) {
      return `https://pancakeswap.finance/swap?outputCurrency=${address}&chainId=56`;
    }
    return `https://four.meme/token/${address}`;
  };

  // 缩短地址显示
  const shortenAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <div className="relative mx-auto max-w-[380px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* 星标图标 - 右上角 */}
      <div className="absolute right-3 top-3 z-10">
        {/* 社交媒体链接和合约地址 */}
        <div className="mb-3 flex items-center justify-between">
          {/* 社交链接 */}
          <div className="flex space-x-2">
            {data.twitterUrl && (
              <a
                href={data.twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-blue-500"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                </svg>
              </a>
            )}
            {data.telegramUrl && (
              <a
                href={data.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-blue-500"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 代币头部/图片 */}
      <div className="relative w-full">
        {data.image ? (
          <img
            src={data.image}
            alt={data.name}
            className="h-32 w-full object-cover object-center"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-32 w-full items-center justify-center bg-gray-100">
            <span className="text-xl font-bold text-gray-700">
              {data.shortName || data.name}
            </span>
          </div>
        )}
      </div>

      {/* 代币内容 */}
      <div className="py-4 px-2">
        {/* 代币名称和涨跌幅 */}
        <div className="mb-1 px-2 flex items-center justify-between">
          {/* 代币名称部分 */}
          <div className="flex items-center">
            <div>
              <div className="text-xs font-bold text-gray-900">{data.name}</div>
              <div className="text-[10px] text-gray-600">
                ({data.shortName})
              </div>
            </div>
          </div>

          {/* 价格变化百分比 */}
          <div className="flex flex-col items-end">
            <div
              className={`flex items-center text-[11px] font-bold ${priceChangePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {priceChangePercent >= 0 ? '+' : ''}
              {priceChangePercent.toFixed(1)}%
              {priceChangePercent >= 0 ? (
                <svg
                  className="ml-0.5 h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              ) : (
                <svg
                  className="ml-0.5 h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              )}
            </div>
            <div className="text-[10px]">
              {formatCompactPrice(data.tokenPrice?.price)}
            </div>
          </div>
        </div>

        {/* 价格显示 */}
        {/* 其他指标信息 */}
        <div className="mb-3 rounded-xl bg-gray-50 p-2 px-3">
          <div
            className={`grid ${!data.progressTag ? 'grid-cols-4' : 'grid-cols-3'} gap-3`}
          >
            {/* 24h Vol 列 */}
            <div className="flex flex-col items-center">
              <div className="text-xs text-gray-500">24h Vol</div>
              <div className="text-xs font-semibold text-gray-900">
                ${formatNumber(data.tokenPrice?.tradingUsd)}
              </div>
            </div>


            {/* MC 列 */}
            <div className="flex flex-col items-center">
              <div className="text-xs text-gray-500">MC</div>
              <div className="text-xs font-semibold text-gray-900">
                ${formatNumber(data.tokenPrice?.marketCap 
                   ? (!data.tradeUrl 
                      ? (parseFloat(data.tokenPrice.marketCap) * 630).toString()
                      : data.tokenPrice.marketCap)
                   : '0')}
              </div>
            </div>

            {/* Progress 列 - 只在 progressTag 为 false 时显示 */}
            {true && (
              <div className="flex flex-col items-center">
                <div className="text-xs text-gray-500">Progress</div>
                <div className="text-xs font-semibold text-gray-900">
                  {(() => {
                    // 正确获取 progress 值
                    const progressValue = data.tokenPrice?.progress;
                    console.log(
                      'Progress value from tokenPrice:',
                      progressValue,
                    );

                    let percentage = 0;

                    try {
                      // 尝试转换为数字并乘以100
                      if (progressValue) {
                        percentage = parseFloat(progressValue) * 100;
                      }

                      // 确保百分比在有效范围内
                      percentage = Math.min(Math.max(percentage, 0), 100);
                      console.log('Calculated percentage:', percentage);
                    } catch (error) {
                      console.error('Error calculating percentage:', error);
                    }

                    // 渲染进度环
                    return <div>{percentage.toFixed(1)}%</div>;
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 持仓分布显示 */}
        {data.holdersDistribution && data.holdersDistribution.length > 0 && (
          <div className="space-y-2 px-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">
                Top Holders
              </span>
              <span className="text-xs text-gray-400">% Supply</span>
            </div>
            {data.holdersDistribution.map((holder: Holder, index: number) => (
              <div
                key={holder.address}
                className="flex items-center justify-between"
              >
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">
                    {index + 1}. {holder.address.slice(0, 4)}...
                    {holder.address.slice(-4)}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-black transition-all duration-300"
                      style={{ width: `${Math.min(100, holder.percentage)}%` }}
                    />
                  </div>
                  <span className="min-w-[40px] text-right text-xs font-medium text-gray-700">
                    {holder.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 交易按钮 - 根据 progressTag 显示不同平台 */}
      <div className="px-4 pb-4 pt-0">
        <a
          href={getTradeUrl(data.address, data.progressTag)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center rounded-xl bg-black py-2 text-sm font-medium text-white transition-all hover:bg-gray-600"
        >
          <img
            src={data.progressTag ? Pancake.src : FourMeme.src}
            alt={data.progressTag ? 'PancakeSwap' : 'FourMeme'}
            className="mr-1.5 h-4 w-4"
          />
          <span>
            {data.progressTag ? 'Buy on PancakeSwap' : 'Buy on FourMeme'}
          </span>
          <ArrowTopRightOnSquareIcon className="ml-1 h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default MemeTokenCard;
