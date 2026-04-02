import { useState } from 'react';

interface TaskCardProps {
  content: string;
  hours: string;
}

export default function TaskCard({ content, hours }: TaskCardProps) {
  return (
    <div className="card-compact flex h-full flex-col overflow-hidden rounded-2xl border-[1px] border-t border-gray-100">
      <div className="card-body flex-grow !p-3 !pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-grow">
            <div className="flex items-start justify-between">
              <div className="flex-grow"></div>
              <div className="flex items-center justify-between text-[11px] text-gray-600">
                <span className="font-mono text-[13px] tabular-nums text-gray-500">
                  {hours}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <p className="line-clamp-3 break-words text-xs leading-5">{content}</p>
      </div>
      <div className="mb-3 flex justify-between px-3 text-xs text-gray-500">
        <div className="flex items-center">10,000 Participants</div>
        <div className="flex items-center">1000 $USDT</div>
      </div>
    </div>
  );
}
