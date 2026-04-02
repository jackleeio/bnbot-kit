// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import Image from "next/image";
import { motion } from "framer-motion";

import bnbotAI from "~/assets/images/logo/bnbot-ai.jpg";
import { cn } from "~/lib/utils";

export function Welcome({ className }: { className?: string }) {

  return (
    <motion.div
      className={cn("flex flex-col items-center -mt-20", className)}
      style={{ transition: "all 0.2s ease-out" }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Image
        src={bnbotAI}
        alt="BNBOT AI"
        width={72}
        height={72}
        className="mb-4 h-[72px] w-[72px] rounded-full border border-border object-cover shadow-sm"
        priority
      />
      <h3 className="mb-2 text-center text-3xl font-medium ">X Insight - BNBot Deep Research</h3>
      <div className="text-muted-foreground px-4 text-center text-sm">
        Ask me anything and I'll conduct deep research to provide comprehensive answers.
      </div>
    </motion.div>
  );
}
