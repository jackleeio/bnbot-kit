// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import { PenLine } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/deep-research/ui/button";
import { resetChat, useStore } from "~/core/store";

// Dynamically import components to avoid hydration issues
const Main = dynamic(() => import("./chat/main"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      Loading BNBOT...
    </div>
  ),
});


export default function HomePage() {
  const [isClient, setIsClient] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const handleStartNewChat = useCallback(() => {
    resetChat();
  }, []);

  useEffect(() => {
    setIsClient(true);
    // Add a small delay to ensure client-side hydration is complete
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const openResearchId = useStore((state) => state.openResearchId);

  if (!isClient || !isReady) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading BNBOT Deep Research...
      </div>
    );
  }

  return (
    <div className="flex h-screen justify-center overflow-hidden relative">
      {/* Floating Actions in Top Right */}
      {openResearchId === null && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleStartNewChat}
            aria-label="Start new chat"
            title="Start new chat"
            className="rounded-full"
          >
            <PenLine className="h-4 w-4" />
          </Button>
        </div>
      )}
      <Main />
    </div>
  );
}
