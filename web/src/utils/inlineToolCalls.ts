export interface ParsedInlineToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
  inputSummary?: string;
}

export type InlineToolCallSegment =
  | { type: 'text'; value: string }
  | { type: 'tool_call'; call: ParsedInlineToolCall };

const PRIORITY_KEYS = [
  'q',
  'query',
  'keyword',
  'keywords',
  'prompt',
  'text',
  'input',
  'address',
  'name',
  'title',
];

const toDisplayValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const compact = value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '')))
      .filter(Boolean)
      .join(', ');
    return compact || undefined;
  }
  return undefined;
};

const findMatchingBraceIndex = (text: string, startIndex: number) => {
  if (text[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let currentQuote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (currentQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === currentQuote) {
        currentQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      currentQuote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return null;
};

export const buildToolInputSummary = (
  toolName: string,
  input: Record<string, unknown> | undefined,
): string | undefined => {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  for (const key of PRIORITY_KEYS) {
    const value = input[key];
    const display = toDisplayValue(value);
    if (display) {
      return display;
    }
  }

  for (const [key, value] of Object.entries(input)) {
    const display = toDisplayValue(value);
    if (display) {
      return `${key}: ${display}`;
    }
  }

  return undefined;
};

const parseObjectLike = (raw: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    try {
      // Handle Python-style dicts where strings are single-quoted
      // and might contain double quotes inside (e.g. {'q': '"query"'})
      // 1. Escape existing double quotes
      const escapedDouble = raw.replace(/"/g, '\\"');
      // 2. Replace single quotes with double quotes
      const normalized = escapedDouble.replace(/'/g, '"');
      return JSON.parse(normalized);
    } catch (_error2) {
      try {
        // Fallback to simple replacement
        const normalized = raw.replace(/'/g, '"');
        return JSON.parse(normalized);
      } catch (_error3) {
        return null;
      }
    }
  }
};

export const parseInlineToolCallSegments = (input: string): InlineToolCallSegment[] => {
  if (!input) {
    return [{ type: 'text', value: input }];
  }

  const segments: InlineToolCallSegment[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const braceStart = input.indexOf('{', cursor);
    if (braceStart === -1) {
      break;
    }
    const closingIndex = findMatchingBraceIndex(input, braceStart);
    if (closingIndex === null) {
      break;
    }

    const rawObject = input.slice(braceStart, closingIndex);
    const parsed = parseObjectLike(rawObject);

    // Check if this is a tool call JSON
    // Format 1: {"type": "tool_call", "name": "...", "args": {...}}
    // Format 2: {"type": "tool_start", "name": "...", "input": {...}}
    // Format 3: {"name": "tool_name", "args": {...}} (without type field)

    // Skip if parsed is null or not an object
    if (!parsed || typeof parsed !== 'object') {
      cursor = closingIndex;
      continue;
    }

    const parsedType = (parsed as { type?: string })?.type;
    const isToolCallWithType =
      parsedType === 'tool_call' || parsedType === 'tool_start';

    const callName =
      (parsed as { name?: string }).name ??
      (parsed as { tool_name?: string }).tool_name ??
      '';

    // Format 3 detection: has 'name' and 'args'/'input' fields (likely a tool call even without type)
    const isToolCallWithoutType =
      callName &&
      ((parsed as { args?: unknown }).args !== undefined ||
        (parsed as { input?: unknown }).input !== undefined);

    if (isToolCallWithType || isToolCallWithoutType) {
      if (callName) {
        if (braceStart > cursor) {
          segments.push({ type: 'text', value: input.slice(cursor, braceStart) });
        }

        const toolId = (parsed as { id?: string }).id;
        const args =
          (parsed as { args?: Record<string, unknown> }).args ??
          (parsed as { input?: Record<string, unknown> }).input ??
          {};

        segments.push({
          type: 'tool_call',
          call: {
            id: toolId,
            name: callName,
            input: args,
            inputSummary: buildToolInputSummary(callName, args),
          },
        });

        cursor = closingIndex;
        continue;
      }
    }

    cursor = braceStart + 1;
  }

  if (cursor < input.length) {
    segments.push({ type: 'text', value: input.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: input }];
};
