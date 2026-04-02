// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import { useMemo } from "react";

import { useStore } from "~/core/store";
import { cn } from "~/lib/utils";

import { MessagesBlock } from "./components/messages-block";
import { ResearchBlock } from "./components/research-block";

export default function Main() {
  const openResearchId = useStore((state) => state.openResearchId);
  const doubleColumnMode = useMemo(
    () => openResearchId !== null,
    [openResearchId],
  );
  return (
    <div
      className={cn(
        "flex h-full w-full items-start pl-2 pr-1 pt-1 pb-2 sm:pl-4 sm:pr-3 sm:pt-3 sm:pb-3",
        doubleColumnMode ? "justify-start gap-4 sm:gap-6" : "justify-center",
      )}
    >
      {!doubleColumnMode ? (
        <MessagesBlock
          className={cn(
            "w-full max-w-[768px] transition-all duration-300 ease-out",
          )}
        />
      ) : (
        <>
          <MessagesBlock
            className={cn(
              "shrink-0 transition-all duration-300 ease-out min-w-0 w-full max-w-[538px]",
            )}
          />
          <ResearchBlock
            className={cn(
              "flex-1 min-w-0 w-full max-w-[1120px] transition-all duration-300 ease-out overflow-hidden",
            )}
            researchId={openResearchId}
          />
        </>
      )}
    </div>
  );
}
