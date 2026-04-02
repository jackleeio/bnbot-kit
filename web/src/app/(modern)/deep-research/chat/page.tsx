// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Dynamically import components to avoid hydration issues
const Main = dynamic(() => import("./main"), {
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

  useEffect(() => {
    setIsClient(true);
    // Add a small delay to ensure client-side hydration is complete
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  if (!isClient || !isReady) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        Loading BNBOT...
      </div>
    );
  }

  return <Main />;
}