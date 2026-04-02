'use client';

import React, { useState } from 'react';
import { ethers } from 'ethers';

const Assistant: React.FC = () => {
  const [description, setDescription] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleCreate = async () => {
    if (!description.trim()) return;
    
    try {
      setIsLoading(true);
      // 这里可以添加创建资产的逻辑，比如与智能合约交互
      console.log('创建资产:', description);
      
      // 模拟与区块链交互的延迟
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 清空输入
      setDescription('');
    } catch (error) {
      console.error('创建资产失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mx-auto flex w-full flex-col">
        <div className="mx-auto w-full max-w-[600px]">
          <div className="w-full">
            <div className="relative mx-auto w-full max-w-[540px]">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your task for BNBOT"
                className="mx-auto block w-full rounded-3xl border-0 py-3 px-4 text-center text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-[#f0b90b] text-base transition-transform duration-200 hover:scale-[1.02] focus:scale-[1.02] active:scale-[0.98] resize-none min-h-[120px]"
              />
            </div>
          </div>

          {isLoading && (
            <p className="mt-4 flex items-center justify-center text-center text-sm text-black">
              <span className="loading loading-spinner loading-xs mr-2 text-[#f0b90b]"></span>
              <span>Processing...</span>
            </p>
          )}

          <div className="mt-6 w-full max-w-[540px] mx-auto">
            <button
              onClick={handleCreate}
              disabled={isLoading || !description.trim()}
              className={`w-full rounded-full ${
                isLoading || !description.trim() 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-[#f0b90b] hover:bg-[#e6af0a] hover:shadow-lg'
              } px-5 py-3 text-lg font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]`}
            >
              Create AI Task
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Assistant;