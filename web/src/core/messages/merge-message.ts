// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import type {
  ChatEvent,
  InterruptEvent,
  MessageChunkEvent,
  ToolCallChunksEvent,
  ToolCallResultEvent,
  ToolCallsEvent,
} from "../api";

import type { Message, ToolCallRuntime } from "./types";

export function mergeMessage(message: Message, event: ChatEvent) {
  let next = message;

  if (event.type === "message_chunk") {
    next = mergeTextMessage(next, event);
  } else if (event.type === "tool_calls" || event.type === "tool_call_chunks") {
    next = mergeToolCallMessage(next, event);
  } else if (event.type === "tool_call_result") {
    next = mergeToolCallResultMessage(next, event);
  } else if (event.type === "interrupt") {
    next = mergeInterruptMessage(next, event);
  }

  if (event.data.finish_reason) {
    next = finalizeStreaming(next, event.data.finish_reason);
  }

  return next;
}

function mergeTextMessage(message: Message, event: MessageChunkEvent) {
  const { content, reasoning_content: reasoningContent } = event.data;
  if (!content && !reasoningContent) {
    return message;
  }

  const contentChunks = content
    ? [...message.contentChunks, content]
    : message.contentChunks;
  const next: Message = {
    ...message,
    content: content ? message.content + content : message.content,
    contentChunks,
  };

  if (reasoningContent) {
    const existingChunks = message.reasoningContentChunks ?? [];
    next.reasoningContent = (message.reasoningContent ?? "") + reasoningContent;
    next.reasoningContentChunks = [...existingChunks, reasoningContent];
  }

  return next;
}

function mergeToolCallMessage(
  message: Message,
  event: ToolCallsEvent | ToolCallChunksEvent,
) {
  let toolCalls = message.toolCalls?.map(cloneToolCall);
  let changed = false;

  if (event.type === "tool_calls" && event.data.tool_calls?.length) {
    toolCalls = event.data.tool_calls.map((raw) => {
      let args: Record<string, unknown> | undefined;
      if (typeof raw.args === "string") {
        const decodedArgs = decodeHtmlEntities(raw.args);
        try {
          args = JSON.parse(decodedArgs);
        } catch (error) {
          console.error(
            "[mergeMessage] Failed to parse tool call args string",
            decodedArgs,
            error,
          );
        }
      } else if (raw.args) {
        args = raw.args;
      }
      return {
        id: raw.id,
        name: raw.name,
        args: args ?? {},
        result: undefined,
      };
    });
    changed = true;
  }

  const toolCallChunks = event.data.tool_call_chunks ?? [];
  if (toolCallChunks.length) {
    toolCalls ??= [];

    for (const chunk of toolCallChunks) {
      const decoded = chunk.args ? decodeHtmlEntities(chunk.args) : undefined;
      if (!decoded) {
        continue;
      }

      if (chunk.id) {
        const index = toolCalls.findIndex((toolCall) => toolCall.id === chunk.id);
        if (index !== -1) {
          const target = toolCalls[index]!;
          toolCalls[index] = {
            ...target,
            argsChunks: [decoded],
          };
        } else {
          toolCalls.push({
            id: chunk.id,
            name: "",
            args: {},
            argsChunks: [decoded],
          });
        }
      } else {
        const streamingIndex = toolCalls.findIndex(
          (toolCall) => toolCall.argsChunks && toolCall.argsChunks.length > 0,
        );
        if (streamingIndex !== -1) {
          const target = toolCalls[streamingIndex]!;
          toolCalls[streamingIndex] = {
            ...target,
            argsChunks: [...(target.argsChunks ?? []), decoded],
          };
        }
      }
    }
    changed = true;
  }

  return changed ? { ...message, toolCalls } : message;
}

function mergeToolCallResultMessage(
  message: Message,
  event: ToolCallResultEvent,
) {
  if (!message.toolCalls?.length) {
    return message;
  }

  const toolCallIndex = message.toolCalls.findIndex(
    (toolCall) => toolCall.id === event.data.tool_call_id,
  );
  if (toolCallIndex === -1) {
    return message;
  }

  const toolCalls = message.toolCalls.map((toolCall, index) => {
    if (index !== toolCallIndex) {
      return toolCall;
    }
    let result = "";
    const { content } = event.data;
    if (typeof content === "string") {
      result = content;
    } else if (content != null) {
      try {
        result = JSON.stringify(content);
      } catch (error) {
        console.error(
          "[mergeMessage] Failed to serialise tool call result",
          content,
          error,
        );
        result = String(content);
      }
    }
    return {
      ...toolCall,
      result,
    };
  });

  return { ...message, toolCalls };
}

function mergeInterruptMessage(message: Message, event: InterruptEvent) {
  if (!event.data.options) {
    return { ...message, isStreaming: false };
  }
  return {
    ...message,
    isStreaming: false,
    options: event.data.options,
  };
}

function finalizeStreaming(
  message: Message,
  finishReason: Message["finishReason"],
) {
  let toolCalls = message.toolCalls;
  if (toolCalls?.length) {
    toolCalls = toolCalls.map((toolCall) => {
      if (!toolCall.argsChunks?.length) {
        return toolCall;
      }
      const rawArgs = toolCall.argsChunks.join("");
      let args: Record<string, unknown> = toolCall.args ?? {};
      try {
        args = JSON.parse(rawArgs);
      } catch (error) {
        console.error(
          "[mergeMessage] Failed to parse tool call args",
          rawArgs,
          error,
        );
        args = {};
      }
      return {
        ...toolCall,
        args,
        argsChunks: undefined,
      };
    });
  }

  return {
    ...message,
    toolCalls,
    finishReason,
    isStreaming: false,
  };
}

function cloneToolCall(toolCall: ToolCallRuntime): ToolCallRuntime {
  return {
    id: toolCall.id,
    name: toolCall.name,
    args: toolCall.args,
    argsChunks: toolCall.argsChunks ? [...toolCall.argsChunks] : undefined,
    result: toolCall.result,
  };
}

function decodeHtmlEntities(value: string) {
  if (!value || !value.includes("&")) {
    return value;
  }
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const decimal = Number.parseInt(code, 10);
      return Number.isNaN(decimal) ? "" : String.fromCharCode(decimal);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const value = Number.parseInt(hex, 16);
      return Number.isNaN(value) ? "" : String.fromCharCode(value);
    });
}
