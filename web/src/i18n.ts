// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

// Can be imported from a shared config
const locales: Array<string> = ["zh", "en"];

export default getRequestConfig(async () => {
  // English only
  return {
    messages: (await import(`../messages/en.json`)).default,
    locale: "en",
  };
});