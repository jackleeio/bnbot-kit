import React from 'react';
import katex from 'katex';
import { TableData } from '@/types/chat';

// Format tool name for display
export const formatToolName = (toolName: string) => {
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const normalizeMentionWithEscapedUnderscores = (value: string) => {
  return value.replace(/(?:\\|\s)+/g, '');
};

// Render LaTeX math formula using KaTeX
const renderMath = (formula: string, displayMode: boolean = false): string => {
  try {
    return katex.renderToString(formula, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      output: 'html',
    });
  } catch (error) {
    console.warn('KaTeX render error:', error);
    // Return original formula wrapped in code style if rendering fails
    return `<code class="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono text-gray-800">${formula}</code>`;
  }
};

// Check if a $...$ pattern is a LaTeX formula (not a token symbol like $BTC)
const isLatexFormula = (content: string): boolean => {
  const trimmed = content.trim();

  // Single letter (uppercase or lowercase) is always a math variable, not a token
  // e.g., $G$ (gravitational constant), $x$, $T$
  if (/^[A-Za-z]$/.test(trimmed)) {
    return true;
  }

  // Token symbols: $BTC, $ETH - multiple uppercase letters/numbers (at least 2 chars)
  // LaTeX formulas: $x^2$, $\sqrt{2}$, $a + b$ - contains operators, commands, or lowercase
  const tokenPattern = /^[A-Z][A-Z0-9]+$/; // Changed from * to + (require at least 2 chars)
  if (tokenPattern.test(trimmed)) {
    return false; // It's a token symbol
  }

  // Contains LaTeX commands (\sqrt, \frac, etc.) or math operators
  if (/\\[a-zA-Z]+|[+\-*/^_{}=<>]|\d+/.test(trimmed)) {
    return true;
  }

  // Multiple words or lowercase letters suggest formula
  if (/[a-z]/.test(trimmed) || /\s/.test(trimmed)) {
    return true;
  }

  return false;
};

// Format general chat content (mentions, tokens, markdown) into HTML string
export const formatChatContent = (text: string) => {
  if (!text) return '';

  let cleanText = text;

  // Process block-level LaTeX formulas first: $$...$$ (can span multiple lines)
  // Match $$ followed by content and closing $$, handling newlines between them
  cleanText = cleanText.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, formula) => {
    const trimmedFormula = formula.trim();
    if (!trimmedFormula) return _match;
    const rendered = renderMath(trimmedFormula, true);
    return `<div class="overflow-x-auto katex-block">${rendered}</div>`;
  });

  // Process inline LaTeX formulas: $...$
  // But distinguish from token symbols like $BTC
  cleanText = cleanText.replace(/\$([^$\n]+)\$/g, (_match, content) => {
    if (isLatexFormula(content)) {
      return renderMath(content.trim(), false);
    }
    // Not a LaTeX formula, return original (will be processed as token later if applicable)
    return _match;
  });

  // Process headings
  cleanText = cleanText.replace(
    /^(#{1,6})\s*(.+)$/gm,
    (_match, hashes: string, headingText: string) => {
      const level = Math.min(hashes.length, 6);
      const headingClasses: Record<number, string> = {
        1: 'text-2xl font-semibold text-gray-900 mt-6 mb-2',
        2: 'text-xl font-semibold text-gray-900 mt-5 mb-2',
        3: 'text-lg font-semibold text-gray-900 mt-4 mb-2',
        4: 'text-base font-semibold text-gray-900 mt-3 mb-1.5',
        5: 'text-sm font-semibold text-gray-800 mt-3 mb-1.5',
        6: 'text-xs font-semibold text-gray-700 mt-3 mb-1.5',
      };
      return `<span class="block ${headingClasses[level]}">${headingText.trim()}</span>`;
    },
  );

  // Process list items (*, -, +)
  cleanText = cleanText
    .replace(
      /^(\s*)[*+-]\s+/gm,
      (_match, indent: string) =>
        `${indent}<span class="text-gray-500">•</span> `,
    )
    .replace(
      /\n(\s*)[*+-]\s+/g,
      (_match, indent: string) =>
        `\n${indent}<span class="text-gray-500">•</span> `,
    );

  // Process code blocks (``` ... ```) before inline code
  cleanText = cleanText.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, language, code) => {
    const lang = language ? `data-language="${language}"` : '';
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .trimEnd();
    return `<div class="my-3 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-[#fafafa] shadow-sm">
      ${language ? `<div class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2"><span class="text-xs font-medium text-gray-500">${language}</span></div>` : ''}
      <pre class="overflow-x-auto p-4 text-[13px] leading-relaxed max-w-full" ${lang}><code class="font-mono text-gray-800">${escapedCode}</code></pre>
    </div>`;
  });

  // Process inline code (backticks) before mentions to avoid conflicts
  cleanText = cleanText.replace(/`([^`]+)`/g, (_match, code) => {
    return `<code class="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono text-gray-800">${code}</code>`;
  });

  // Normalize escaped underscores inside mentions like "@user \_name"
  cleanText = cleanText.replace(
    /@([\w]+(?:[\s\\]*_[\s\\]*[\w]+)*)/g,
    (match) => normalizeMentionWithEscapedUnderscores(match),
  );

  // Process @usernames with parentheses
  cleanText = cleanText.replace(
    /(@\w+)\(([^)]+)\)/g,
    (_match, username, name) => {
      const cleanUsername = String(username).substring(1);
      const displayName = String(name).trim() || `@${cleanUsername}`;
      return `<span class="mention-user text-[13px] text-blue-600 font-medium hover:underline cursor-pointer" data-username="${cleanUsername}">${displayName}</span>`;
    },
  );

  // Process plain @username
  cleanText = cleanText.replace(/@(\w+)(?!\w|\()/g, (_match, username) => {
    return ` <span class="mention-user text-[13px] text-blue-600 font-medium hover:underline cursor-pointer" data-username="${username}">@${username}</span> `;
  });

  // Process bold text **...**
  // Match ** pairs that contain non-empty content (not just whitespace or asterisks)
  cleanText = cleanText.replace(/\*\*([^*]+?)\*\*/g, (_match, content) => {
    // Skip if content is only whitespace
    if (!content.trim()) return _match;
    return `<strong class="font-semibold text-gray-900">${content}</strong>`;
  });

  // Process italic text (single *...*), allow行首/行内，但排除 **bold**
  cleanText = cleanText.replace(
    /(^|[\s[(>])\*(?!\*)([^*\n]+?)\*(?!\*)(?=[\s.,;:!?)\]]|$)/g,
    (_match, prefix, content) => {
      return `${prefix}<em class="italic">${content}</em>`;
    },
  );

  // Process token symbols
  cleanText = cleanText.replace(/\$([A-Za-z][\w]*)/g, (_match, token) => {
    return `<span class="font-medium" style="color: #f0b90b">$${token}</span>`;
  });

  // Process hashtags
  cleanText = cleanText.replace(
    /#(?![a-fA-F0-9]{6}\b)(\w+)/g,
    '<span class="text-blue-500">#$1</span>',
  );

  // Process links
  cleanText = cleanText.replace(
    /https?:\/\/[^\s]+/g,
    '<a href="$&" target="_blank" class="text-blue-500 hover:underline">$&</a>',
  );

  // Replace explicit <br> tags with React-compatible breaks
  cleanText = cleanText.replace(/<br\s*\/?>/gi, '<br />');

  return cleanText;
};

// Format reasoning/thinking content with markdown support
export const formatReasoningContent = (content: string) => {
  if (!content) return null;

  // Handle multiple markdown patterns: **bold**, *italic*, `code`
  const parts = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      // Bold text
      return (
        <strong key={index} className="font-bold text-gray-800">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (
      part.startsWith('*') &&
      part.endsWith('*') &&
      !part.startsWith('**')
    ) {
      // Italic text
      return (
        <em key={index} className="font-medium italic text-gray-600">
          {part.slice(1, -1)}
        </em>
      );
    } else if (part.startsWith('`') && part.endsWith('`')) {
      // Inline code with improved styling
      const codeContent = part.slice(1, -1);
      // Check if it's a tool name (contains underscore and is a known tool pattern)
      const isToolName =
        codeContent.includes('_') && /^[a-z_]+$/.test(codeContent);

      if (isToolName) {
        // Format tool names with special styling
        const formattedName = codeContent
          .split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        return (
          <span
            key={index}
            className="inline-block rounded-md bg-[#f0b90b]/10 px-1 py-0.5 text-xs text-gray-700"
          >
            {formattedName}
          </span>
        );
      } else {
        // Regular code styling
        return (
          <code
            key={index}
            className="rounded-md border border-gray-200 bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800 shadow-sm"
          >
            {codeContent}
          </code>
        );
      }
    } else {
      // Regular text with line breaks preserved
      return part.split('\n').map((line, lineIndex) => (
        <span key={`${index}-${lineIndex}`}>
          {line}
          {lineIndex < part.split('\n').length - 1 && <br />}
        </span>
      ));
    }
  });
};

// Parse markdown tables from content
export const parseMarkdownTable = (
  content: string,
): {
  tableData: TableData | null;
  remainingContent: string;
} => {
  console.log('Parsing table from content:', content.substring(0, 200) + '...');
  const lines = content.split('\n');

  // Check if content might be an incomplete table
  const lastLine = content.trim().split('\n').pop() || '';
  const isIncompleteTable =
    (lastLine.endsWith('|---') || lastLine.endsWith('---|')) &&
    !lastLine.includes('|--') &&
    !lastLine.includes('--|');

  if (isIncompleteTable) {
    console.log('Detected incomplete table, skipping parsing');
    return { tableData: null, remainingContent: content };
  }

  const isPipeTableLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('|')) {
      return false;
    }

    const cellCount = trimmed
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0).length;

    return cellCount >= 2;
  };

  let tableStart = -1;
  let tableEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isPipeTableLine(line)) {
      if (tableStart === -1) {
        tableStart = i;
        console.log('Pipe table start detected at line', i, ':', line.trim());
      }
      tableEnd = i;
      continue;
    }

    if (tableStart !== -1) {
      console.log('Pipe table ended at line', i, ':', line.trim());
      break;
    }
  }

  if (tableStart === -1) {
    console.log('No table detected in content');
    return { tableData: null, remainingContent: content };
  }

  if (tableEnd === tableStart) {
    console.log('Only a single pipe line detected, skipping table render');
    return { tableData: null, remainingContent: content };
  }

  console.log('Table detected from line', tableStart, 'to', tableEnd);

  // Extract table lines
  const tableLines = lines
    .slice(tableStart, tableEnd + 1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (tableLines.length < 2) {
    return { tableData: null, remainingContent: content };
  }

  let headers: string[] = [];
  let rows: string[][] = [];

  // Handle pipe-separated tables
  let separatorIndex = -1;
  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i];
    // Check for separator line
    if (/^\s*\|[\s\-:|\s]+\|?\s*$/.test(line)) {
      separatorIndex = i;
      console.log('Found separator at line', i, ':', line);
      break;
    }
  }

  if (separatorIndex <= 0) {
    console.log('Pipe lines detected but no separator row, skipping table parsing');
    return { tableData: null, remainingContent: content };
  }

  // Standard table with header and separator
  const headerLine = tableLines[0];
  headers = headerLine
    .split('|')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);

  // If headers are insufficient, treat as non-table content
  if (headers.length === 0) {
    console.log('Header line did not produce valid columns, skipping table parsing');
    return { tableData: null, remainingContent: content };
  }

  console.log(
    'Parsed headers from line:',
    headerLine,
    '-> headers:',
    headers,
  );

  // Process data rows (skip header and separator)
  for (let i = separatorIndex + 1; i < tableLines.length; i++) {
    const line = tableLines[i];
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length > 0 && cells.some((cell) => cell.length > 0)) {
      rows.push(cells);
    }
  }

  // Ensure we have valid headers and at least one row
  if (headers.length === 0 || rows.length === 0) {
    return { tableData: null, remainingContent: content };
  }

  // Normalize row lengths to match header count
  rows = rows.map((row) => {
    const normalizedRow = [...row];
    while (normalizedRow.length < headers.length) {
      normalizedRow.push('');
    }
    return normalizedRow.slice(0, headers.length);
  });

  // Remove the table from the original content
  const beforeTable = lines.slice(0, tableStart).join('\n');
  const afterTable = lines.slice(tableEnd + 1).join('\n');
  const remainingContent = [beforeTable, afterTable]
    .filter((part) => part.trim())
    .join('\n\n');

  console.log('Successfully parsed table:', { headers, rowCount: rows.length });

  return {
    tableData: { headers, rows },
    remainingContent: remainingContent,
  };
};
