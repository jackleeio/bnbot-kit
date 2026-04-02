
export enum Tab {
  CHAT = 'CHAT',
  BOOST = 'BOOST',
  ANALYSIS = 'ANALYSIS',
  CREDITS = 'CREDITS',
  TWEET_CONTEXT = 'TWEET_CONTEXT',
  DRAFTS = 'DRAFTS',
  AUTO_REPLY = 'AUTO_REPLY',
  SETTINGS = 'SETTINGS',
  X_BALANCE = 'X_BALANCE',
  X_ANALYTICS = 'X_ANALYTICS'
}

export interface ToolCall {
  name: string;
  args?: Record<string, any>;
  result?: string;
}

export interface AttachedFile {
  name: string;
  type: string; // MIME type
  size: number;
  data: string; // base64 encoded data (without data:xxx;base64, prefix)
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  isThinkingExpanded?: boolean;
  isGeneratingImage?: boolean;
  generatedImage?: string; // Data URL for generated image (data:mime_type;base64,...)
  attachedImage?: string; // Data URL for user attached image (Deprecated in favor of attachedImages)
  attachedImages?: string[]; // Data URLs for user attached images
  attachedFiles?: AttachedFile[]; // Files attached to the message (PDF, etc.)
  timestamp: Date;
  errorStatus?: number; // HTTP status code for error messages
}

// Re-export boost types from service for convenience
export type {
  Boost,
  BoostPluginSummary,
  BoostCreate,
  TweetSnapshot,
  BoostListResponse,
  BoostListParams,
} from './services/boostService';

// Legacy BoostTask interface (deprecated - use Boost instead)
export interface BoostTask {
  id: string;
  title: string;
  description: string;
  bounty: string;
  currency: string;
  deadline: string;
  participants: number;
  tags: string[];
}

export interface CryptoToken {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  data: { time: string; value: number }[];
}

export interface AITool {
  id: string;
  name: string;
  description: string;
  icon: string;
}
