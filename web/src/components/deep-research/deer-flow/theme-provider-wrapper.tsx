// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import { usePathname } from "next/navigation";

import { ThemeProvider } from "~/components/deep-research/theme-provider";

export function ThemeProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDeepResearchPage = pathname?.startsWith("/chat") || pathname?.startsWith("/deep-research");

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={"light"}
      enableSystem={isDeepResearchPage}
      forcedTheme={isDeepResearchPage ? "light" : "dark"}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
