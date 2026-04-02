'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import Image from 'next/image';

// Message type definition
interface Message {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  read: boolean;
  avatar?: string;
}

export default function MessagePage() {
  // Sample messages
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      title: 'Elon Musk Tweet Alert',
      content:
        'Elon Musk just tweeted: "Dogecoin might be my favorite cryptocurrency. It\'s pretty cool." The tweet has already gained over 50,000 likes and DOGE price jumped 8% in the last hour. Trading volume increased by 120% across major exchanges.',
      createdAt: new Date('2025-03-31T10:30:00'),
      read: true,
      avatar:
        'https://ui-avatars.com/api/?name=DOGE&background=f0b90b&color=fff',
    },
    {
      id: '2',
      title: 'BNB Chain Update',
      content:
        "BNB Chain has announced a major upgrade called 'Nirvana' scheduled for April 2025. This upgrade aims to increase transaction throughput to 5,000 TPS and reduce gas fees by 40%. The update also includes new zero-knowledge proof implementations for enhanced privacy features.",
      createdAt: new Date('2025-03-31T14:25:00'),
      read: true,
      avatar:
        'https://ui-avatars.com/api/?name=BNB&background=3b82f6&color=fff',
    },
    {
      id: '3',
      title: 'Market Trend Analysis',
      content:
        'The crypto community is actively discussing the "Super Cycle" theory. Analytics show institutional investments have increased 300% since December. Major discussion points include: 1) Central bank digital currencies impact, 2) Regulatory clarity in US and EU markets, 3) Layer 2 solutions becoming mainstream for daily transactions.',
      createdAt: new Date('2025-03-31T16:45:00'),
      read: true,
      avatar:
        'https://ui-avatars.com/api/?name=Trend&background=22c55e&color=fff',
    },
    {
      id: '4',
      title: 'Ethereum Quantum Update',
      content:
        'Ethereum Foundation has revealed plans for the "Quantum" upgrade, set for Q3 2025. Key improvements include:\n1. Sharding implementation with 64 shards\n2. Further reduction in energy consumption by 90%\n3. New EVM features for advanced smart contract capabilities\n4. Cross-chain bridge security protocols\n\nVitalik Buterin stated this could be "the most significant upgrade since The Merge."',
      createdAt: new Date('2025-03-30T09:15:00'),
      read: false,
      avatar:
        'https://ui-avatars.com/api/?name=ETH&background=f0b90b&color=fff',
    },
    {
      id: '5',
      title: 'DeFi Protocol Alert',
      content:
        'Popular DeFi protocol "NexusYield" has reached $10 billion in TVL. Recent developments:\n1. Integration with 12 major blockchains\n2. New lending features with dynamic interest rates\n3. Insurance fund increased to $500 million\n4. DAO governance proposal to expand into real-world assets\n\nThe protocol token NYT has gained 45% in the past week.',
      createdAt: new Date('2025-03-30T11:20:00'),
      read: false,
      avatar:
        'https://ui-avatars.com/api/?name=DeFi&background=ec4899&color=fff',
    },
    {
      id: '6',
      title: 'Regulatory News',
      content:
        'The SEC has approved the first quantum-resistant cryptocurrency ETF. This breakthrough comes after years of regulatory uncertainty. The approval includes guidelines for:\n\n- Custodial security requirements\n- Financial reporting standards\n- Market manipulation prevention measures\n- Liquidity requirements\n\nFinancial analysts predict this could bring $50-100 billion of new institutional investment into the crypto markets.',
      createdAt: new Date('2025-03-30T14:35:00'),
      read: true,
      avatar:
        'https://ui-avatars.com/api/?name=SEC&background=8b5cf6&color=fff',
    },
  ]);

  // Currently selected message
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  // Search text
  const [searchText, setSearchText] = useState('');

  // Reply text being edited
  const [replyText, setReplyText] = useState('');

  // Select first message initially
  useEffect(() => {
    if (messages.length > 0 && !selectedMessage) {
      setSelectedMessage(messages[0]);
    }
  }, [messages, selectedMessage]);

  // Handle message selection
  const handleSelectMessage = (message: Message) => {
    // Mark as read if unread
    if (!message.read) {
      setMessages(
        messages.map((m) => (m.id === message.id ? { ...m, read: true } : m)),
      );
    }
    setSelectedMessage(message);
  };

  // Format message date and time
  const formatMessageTime = (date: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // If today, show only time
    if (date.toDateString() === today.toDateString()) {
      return `Today ${format(date, 'HH:mm')}`;
    }
    // If yesterday, show "Yesterday" and time
    else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${format(date, 'HH:mm')}`;
    }
    // If this year, show month and day with time
    else if (date.getFullYear() === today.getFullYear()) {
      return format(date, 'MMM dd HH:mm');
    }
    // Otherwise show full date and time
    else {
      return format(date, 'yyyy/MM/dd HH:mm');
    }
  };

  // Sort messages by date (descending)
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Filter messages based on search text
  const filteredMessages = sortedMessages.filter(
    (message) =>
      message.title.toLowerCase().includes(searchText.toLowerCase()) ||
      message.content.toLowerCase().includes(searchText.toLowerCase()),
  );

  // Handle sending a message
  const handleSendMessage = () => {
    if (!replyText.trim() || !selectedMessage) return;

    // Add logic to send message
    console.log(
      'Sending message to:',
      selectedMessage.title,
      'Content:',
      replyText,
    );

    // Clear input
    setReplyText('');
  };

  // Handle key press events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100vh-70px)] w-full px-4 py-4">
      {/* Left message list - wider */}
      <div className="mr-4 w-[420px] overflow-hidden overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-[#f0b90b]/5 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-800">Messages</h2>
        </div>

        <div className="px-3 py-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Search"
              className="mx-auto block w-full rounded-3xl border-0 py-2 text-left text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 transition-transform duration-200 placeholder:text-gray-400 hover:scale-[1.02] focus:scale-[1.02] focus:ring-2 focus:ring-inset focus:ring-[#f0b90b] active:scale-[0.98] sm:text-sm sm:leading-6"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-2 divide-y divide-gray-100">
          {filteredMessages.map((message) => (
            <div
              key={message.id}
              className={`cursor-pointer px-3 py-3 transition-colors ${
                selectedMessage?.id === message.id
                  ? 'border-l-4 border-[#f0b90b] bg-[#f0b90b]/10'
                  : 'hover:bg-[#f0b90b]/5'
              }`}
              onClick={() => handleSelectMessage(message)}
            >
              <div className="mb-1 flex items-center justify-between">
                <h4
                  className={`truncate text-sm font-medium text-gray-900 ${!message.read ? 'font-semibold' : ''}`}
                >
                  {message.title}
                  {!message.read && (
                    <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[#f0b90b]"></span>
                  )}
                </h4>
                <span className="whitespace-nowrap text-xs text-gray-500">
                  {formatMessageTime(new Date(message.createdAt))}
                </span>
              </div>
              <p className="truncate text-xs text-gray-600">
                {message.content.substring(0, 60)}
                {message.content.length > 60 ? '...' : ''}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Right chat area */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {selectedMessage ? (
          <>
            {/* Chat header */}
            <div className="rounded-t-2xl border-b border-gray-200 bg-[#f0b90b]/5 px-4 py-3">
              <h2 className="text-base font-semibold text-gray-900">
                {selectedMessage.title}
              </h2>
              <div className="text-xs text-gray-500">Bot Assistant</div>
            </div>

            {/* Chat content area */}
            <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
              <div className="mx-auto max-w-3xl">
                {/* Date separator */}
                <div className="mb-4 flex justify-center">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
                    {format(new Date(selectedMessage.createdAt), 'PPP', {
                      locale: enUS,
                    })}
                  </span>
                </div>

                {/* Bot message with avatar */}
                <div className="mb-6 flex items-start">
                  <div className="mr-3 flex-shrink-0">
                    {selectedMessage.avatar ? (
                      <div className="h-8 w-8 overflow-hidden rounded-full">
                        <img
                          src={selectedMessage.avatar}
                          alt={selectedMessage.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0b90b] font-bold text-white">
                        {selectedMessage.title.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="max-w-[85%] flex-1">
                    <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white p-4 shadow-sm">
                      {selectedMessage.content
                        .split('\n')
                        .map((paragraph, i) => (
                          <p
                            key={i}
                            className={`${i > 0 ? 'mt-4' : ''} text-sm text-gray-800`}
                          >
                            {paragraph}
                          </p>
                        ))}
                    </div>
                    <div className="ml-1 mt-1 text-xs text-gray-500">
                      {format(new Date(selectedMessage.createdAt), 'p', {
                        locale: enUS,
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 修改消息输入区域，匹配 reviewer.tsx */}
            <div className="border-t border-gray-200 p-3">
              <div className="relative mx-auto max-w-full">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Reply to ${selectedMessage.title}...`}
                  rows={3}
                  className="mx-auto block max-h-[120px] min-h-[80px] w-full resize-none rounded-3xl border-0 py-3 text-left text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-[#f0b90b]"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!replyText.trim()}
                  className="absolute right-3 top-3 text-gray-400 transition-colors hover:text-[#f0b90b] disabled:text-gray-300 disabled:hover:text-gray-300"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="mb-4 h-16 w-16 text-[#f0b90b]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <p className="mb-1 text-center text-gray-500">
              Select a conversation
            </p>
            <p className="text-center text-xs text-gray-400">
              Choose a conversation from the list to start chatting
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
