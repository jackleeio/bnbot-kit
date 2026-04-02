'use client';

import React, { useState, useEffect } from 'react';
import { ArrowUpRightIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/hooks/useAuth';

interface Order {
  id: string;
  charge_id: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
  receipt_url: string;
  onchain_tx_url: string | null;
  created_at: string;
  updated_at: string;
}

interface OrdersResponse {
  total: number;
  orders: Order[];
  limit: number;
  offset: number;
}

const FutureCreditsPage = () => {
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState(10);
  const [totalDue, setTotalDue] = useState(10.53);
  const [useCrypto, setUseCrypto] = useState(true);
  const [paymentHistory, setPaymentHistory] = useState<Order[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);

  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();

  // Fetch payment history
  useEffect(() => {
    if (isLoggedIn && !isAuthLoading) {
      fetchPaymentHistory();
      refreshCredits();
    }
  }, [isLoggedIn, isAuthLoading]);

  const fetchPaymentHistory = async () => {
    try {
      setIsLoadingOrders(true);
      const data: OrdersResponse = await apiClient.get('/api/v1/payments/orders');
      setPaymentHistory(data.orders);
    } catch (error) {
      console.error('Error fetching payment history:', error);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  // Calculate total due when amount changes
  useEffect(() => {
    // Simple calculation with 5.3% fee
    const calculatedTotal = amount * 1.053;
    setTotalDue(parseFloat(calculatedTotal.toFixed(2)));
  }, [amount]);

  const handlePurchase = async () => {
    try {
      setIsLoading(true);

      if (!isLoggedIn) {
        alert('Please log in to make a purchase');
        setIsLoading(false);
        return;
      }

      const data = await apiClient.post('/api/v1/payments/create-payment', {
        amount: amount,
        currency: 'USD',
        name: 'Purchase credits',
        description: `Purchase ${amount} credits`,
        redirect_url: `${window.location.origin}/future-credits`,
        cancel_url: `${window.location.origin}/future-credits`,
      });

      if (data.payment_url) {
        window.location.href = data.payment_url;
      } else {
        throw new Error('No payment URL received');
      }
    } catch (error) {
      console.error('Payment creation failed:', error);
      alert('Failed to create payment. Please try again.');
      setIsLoading(false);
    }
  };

  // Format date to relative time (e.g., "2 months ago")
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600)
      return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400)
      return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 2592000)
      return `${Math.floor(diffInSeconds / 86400)} days ago`;
    if (diffInSeconds < 31536000)
      return `${Math.floor(diffInSeconds / 2592000)} months ago`;
    return `${Math.floor(diffInSeconds / 31536000)} years ago`;
  };

  // Add this new function to refresh credits
  const refreshCredits = async () => {
    try {
      setIsRefreshing(true);

      if (!isLoggedIn) {
        alert('Please log in to refresh your credits');
        return;
      }

      const userData = await apiClient.get('/api/v1/payments/credits');

      // Update credits in state
      if (userData.credits !== undefined) {
        setBalance(userData.credits);
      }
    } catch (error) {
      console.error('Error refreshing credits:', error);
      alert('Failed to refresh credits. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

return (
    <div className="mx-auto w-full max-w-3xl p-4 md:w-[35%] md:p-6">
      <div className="mb-6 md:mb-10 text-center">
        <h1 className="flex items-center justify-center text-2xl md:text-3xl font-semibold">
          Future Credits
          <button
            onClick={refreshCredits}
            disabled={isRefreshing}
            className="relative ml-2"
            title="Refresh credits"
          >
            <svg
              className={`h-4 w-4 md:h-5 md:w-5 cursor-pointer ${isRefreshing ? 'animate-spin text-gray-400' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </h1>

        <div className="mt-3 md:mt-4 flex items-center justify-center text-3xl md:text-4xl font-semibold">
          <span className="mr-1 text-2xl md:text-3xl">$</span> {balance.toFixed(3)}
          <div className="group relative ml-2">
            <svg
              className="h-4 w-4 md:h-5 md:w-5 cursor-pointer text-gray-400 group-hover:text-black"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 md:top-full md:bottom-auto md:mb-0 md:mt-2 z-10 hidden w-60 md:w-72 rounded-md border border-gray-200 bg-white p-2 text-left text-xs font-medium text-black shadow-lg group-hover:block">
              This is the legacy purchase flow that will return soon. Use the
              new Credits page to invite friends and earn rewards today.
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl bg-gray-100/50 p-3 md:p-4">
        <div className="mb-3 md:mb-4 flex items-center justify-between">
          <label htmlFor="amount" className="text-sm md:text-md">
            Amount
          </label>
          <input
            id="amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-24 md:w-32 rounded-2xl bg-white p-2 text-right"
          />
        </div>

        <div className="mb-3 md:mb-4 flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-sm md:text-md">Total due</span>
            <div className="group relative ml-2">
              <svg
                className="h-3 w-3 md:h-4 md:w-4 cursor-pointer text-gray-400 group-hover:text-black"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 md:top-full md:bottom-auto md:mb-0 md:mt-2 z-10 hidden w-60 md:w-72 rounded-md border border-gray-200 bg-white p-2 text-xs text-black shadow-lg group-hover:block">
                A total fee of 5% is incurred for crypto purchases.
              </div>
            </div>
          </div>
          <span className="mr-1 font-semibold">${totalDue}</span>
        </div>

        <button
          onClick={handlePurchase}
          disabled={isLoading}
          className="w-full transform rounded-3xl bg-[#f0b90b] py-2 md:py-3 text-sm md:text-base font-medium text-white transition-transform hover:scale-105 hover:bg-black hover:text-[#f0b90b] disabled:bg-gray-400"
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <span className="loading loading-spinner mr-2"></span>
              Processing...
            </span>
          ) : (
            'Purchase'
          )}
        </button>

        <div className="mt-3 md:mt-4 flex items-center justify-start text-xs md:text-sm text-gray-500">
          <span>Transactions may take many minutes to confirm.</span>
          <div className="group relative ml-1">
            <svg
              className="h-3 w-3 md:h-4 md:w-4 cursor-pointer text-gray-400 group-hover:text-black"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 md:top-full md:bottom-auto md:mb-0 md:mt-2 z-10 hidden w-60 md:w-72 rounded-md border border-gray-200 bg-white p-2 text-xs text-black shadow-lg group-hover:block">
              The process depends on Coinbase finalizing the transaction and
              sending us confirmation.
              <br />
              <br />
              Once we receive this, we can issue your credits.
              <br />
              <br />
              While most transactions are quick, some may take up to 24 hours to
              complete.
            </div>
          </div>
        </div>

        <div className="mt-3 md:mt-4 flex items-center justify-between">
          <span className="text-xs md:text-sm">Pay with Crypto</span>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" className="peer sr-only disabled" checked={true} />
            <div className="peer h-5 w-9 md:h-6 md:w-11 !bg-[#f0b90b] rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 md:after:h-5 md:after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-indigo-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
          </label>
        </div>
      </div>

      <div className="mb-4 md:mb-6 mt-8 md:mt-10 text-center text-xs md:text-sm text-gray-500">
        <hr className="mb-4 md:mb-5 border-t border-gray-100" />
        PAYMENT HISTORY
      </div>

      {isLoadingOrders ? (
        <div className="flex items-center justify-center py-8 md:py-10">
          <div className="flex flex-col items-center">
            <p className="mt-3 text-sm text-gray-500">Loading order data...</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="overflow-hidden rounded-2xl border">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm font-semibold">Date</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm font-semibold">Amount</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm font-semibold">Status</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm font-semibold">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {paymentHistory.length > 0 ? (
                  paymentHistory.map((order) => (
                    <tr key={order.id} className="border-t">
                      <td className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm">{order.amount}</td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-center">
                        <span
                          className={`rounded-full px-1.5 md:px-2 py-0.5 md:py-1 text-xs ${
                            order.status === 'confirmed'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-center">
                        {order.receipt_url && (
                          <a
                            href={order.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group inline-flex items-center justify-center text-xs md:text-sm text-blue-500"
                          >
                            <span className="group-hover:underline">View</span>
                            <ArrowUpRightIcon className="ml-1 h-3 w-3 md:h-4 md:w-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm text-gray-500">
                      No payment history found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default FutureCreditsPage;
