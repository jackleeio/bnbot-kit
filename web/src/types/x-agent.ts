export type ToolStatus = 'pending' | 'success' | 'error';

export interface ToolCallInfo {
  name: string;
  status: ToolStatus;
  output?: string;
  id?: string;
  args?: Record<string, unknown>;
  inputSummary?: string;
  index?: number;
}

export interface XAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: string[]; // Legacy format for backward compatibility
  toolCallsInfo?: ToolCallInfo[]; // New format with status
  timestamp: number;
  isStreaming?: boolean;
  tweetDrafts?: TweetDraftData | null;
  status?: 'login_required';
}

export interface TweetDraft {
  id?: string;
  content: string;
  style: string;
  reasoning: string;
  image_suggestion?: {
    has_suggestion: boolean;
    type?: string;
    description?: string;
    image_prompt?: string;
  };
  hashtags: string[];
}

export interface TweetDraftData {
  type: 'tweet_drafts';
  data: {
    drafts: TweetDraft[];
  };
}

export interface XAgentChatState {
  messages: XAgentMessage[];
  currentInput: string;
  isLoading: boolean;
  error: string | null;
}

export interface ToolStartEvent {
  type: 'tool_start';
  name: string;
  input: Record<string, any>;
  id: string;
}

export interface ToolEndEvent {
  type: 'tool_end';
  name: string;
  output: string;
  status: 'success' | 'error';
  id: string;
}

export interface TweetPreviewState {
  currentDraft: TweetDraft | null;
  isEditing: boolean;
  editedText: string;
}

export interface TwitterUserInfo {
  id: string;
  name: string;
  username: string;
  profileImageUrl: string;
  description: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  verified: boolean;
}

export interface SearchedTweet {
  id: string;
  content: string;
  postedAt: string;
  media: string | null;
  replies: number;
  retweets: number;
  likes: number;
  impressions: number;
  url: string;
  mediaDetails?: Array<{
    type: string;
    url: string;
    thumbnail?: string;
  }>;
}
