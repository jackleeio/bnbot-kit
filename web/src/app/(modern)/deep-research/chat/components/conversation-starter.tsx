// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { motion } from "framer-motion";

import { cn } from "~/lib/utils";

import { Welcome } from "./welcome";

export function ConversationStarter({
  className,
  onSend,
}: {
  className?: string;
  onSend?: (message: string) => void;
}) {
  const questions = [
    "Which crypto projects are gaining the most buzz from traders this week?",
    "What are analysts forecasting for Bitcoin’s price action after the latest macro news?",
    "How are top KOLs on X framing the next big narrative in DeFi?",
    "Where are the most attractive on-chain yields right now and what risks do they carry?"
  ];

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="flex items-center justify-center mb-8">
        <Welcome className="w-[75%]" />
      </div>
      <ul className="flex flex-wrap">
        {questions.map((question, index) => (
          <motion.li
            key={question}
            className="flex w-1/2 shrink-0 p-2 active:scale-105"
            style={{ transition: "all 0.2s ease-out" }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{
              duration: 0.2,
              delay: index * 0.1 + 0.5,
              ease: "easeOut",
            }}
          >
            <div
              className="bg-card text-muted-foreground h-full w-full cursor-pointer rounded-2xl border px-4 py-6 opacity-75 transition-all duration-300 hover:opacity-100 hover:shadow-md min-h-[100px] flex items-center"
              onClick={() => {
                onSend?.(question);
              }}
            >
              {question}
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
