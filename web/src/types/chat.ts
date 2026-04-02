export type ToolStatus = 'pending' | 'success' | 'error';

export interface ToolCallInfo {
  name: string;
  status: ToolStatus;
  output?: string;
  id?: string;
  args?: Record<string, unknown>;
  inputSummary?: string;
}

export interface GeneratedTopic {
  title?: string;
  question?: string;
  hook?: string;
  angle?: string;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: string[]; // Legacy format for backward compatibility
  toolCallsInfo?: ToolCallInfo[]; // New format with status
  timestamp?: Date;
  status?: 'sending' | 'success' | 'error' | 'login_required';
  retryCount?: number;
  isRegenerating?: boolean;
  topics?: GeneratedTopic[];
  topicsLoading?: boolean;
  topicsDismissed?: boolean;
}

export interface Tweet {
  id_str: string;
  created_at: string;
  text: string;
  text_zh?: string;
  text_en?: string;
  reply_count: number;
  retweet_count: number;
  like_count: number;
  quote_count: number;
  view_count: string;
  is_retweet: boolean;
  retweeted_status_id: string | null;
  is_quote: boolean;
  quoted_status_id: string | null;
  user: {
    username: string;
    twitter_id: string;
    name: string;
    avatar: string;
    description: string;
  };
  media:
  | {
    type: string;
    url: string;
    thumbnail?: string;
  }[]
  | null;
  quoted_tweet?: {
    id_str: string;
    text: string;
    text_zh?: string;
    text_en?: string;
    created_at: string;
    user: {
      name: string;
      username: string;
      avatar: string;
    };
  } | null;
  retweeted_tweet?: {
    text: string;
    text_zh?: string;
    text_en?: string;
    username: string;
  } | null;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface SelectedAgent {
  id: string;
  name: string;
}

export type SessionStatus = 'idle' | 'active' | 'interrupted' | 'cancelled';

export type ViewMode = 'default' | 'equal';
