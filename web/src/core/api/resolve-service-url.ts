// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { env } from "~/env";

export function resolveServiceURL(path: string, isDeepResearch = false) {
  let BASE_URL: string;

  // Use deep-research API endpoint if configured
  if (isDeepResearch && env.NEXT_PUBLIC_DEEP_RESEARCH_API_ENDPOINT) {
    BASE_URL = env.NEXT_PUBLIC_DEEP_RESEARCH_API_ENDPOINT;
    if (!BASE_URL.endsWith("/")) {
      BASE_URL += "/";
    }
    BASE_URL += "api/";
  } else {
    BASE_URL = env.NEXT_PUBLIC_REST_API_ENDPOINT ?? "http://localhost:8000/api/";
    if (!BASE_URL.endsWith("/")) {
      BASE_URL += "/";
    }
  }

  return new URL(path, BASE_URL).toString();
}
