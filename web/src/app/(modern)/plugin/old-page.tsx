'use client';

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  FormEvent,
} from 'react';
import Image, { type StaticImageData } from 'next/image';
import Masonry from 'react-masonry-css';
import Button from '@/components/ui/button';
import ToggleBar from '@/components/ui/toggle-bar';
import MagicButton from '@/components/ui/magic-button';
import cn from '@/utils/cn';
import { useTelegramBinding } from '@/hooks/useTelegramBinding';
import { useNotification } from '@/context/notification-context';
import LoginModal from '@/components/login/login-modal';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import CharacterDetailsModal, {
  type CharacterPayload,
  type UpdateAgentPayload,
} from '@/components/x-agent/character-details-modal';
import ComposeChatPanel from '@/components/x-agent/compose-chat-panel';

type TweetStatus = 'draft' | 'scheduled' | 'published';

interface GeneratedTweetMetadata {
  topic?: string;
  title?: string;
  headline?: string;
  subject?: string;
  summary?: string;
  content?: string;
  body?: string;
  tags?: string[];
  notes?: string;
  note?: string;
  warning?: string;
  todo?: string;
  status?: TweetStatus;
  [key: string]: unknown;
}

interface RawGeneratedTweet {
  tweet_id?: string | number | null;
  content?: unknown;
  metadata?: unknown;
  topic?: unknown;
  title?: unknown;
  headline?: unknown;
  subject?: unknown;
  summary?: unknown;
  body?: unknown;
  tags?: unknown;
  notes?: unknown;
  note?: unknown;
  warning?: unknown;
  todo?: unknown;
  created_at?: string | number | null;
}

interface GeneratedTweet {
  id: string;
  content: string;
  publishText: string;
  title: string;
  tags: string[];
  status: TweetStatus;
  timestamp: number;
  createdAt?: string;
  notes?: string;
  isNew?: boolean;
  isLocalOnly?: boolean;
  metadata?: GeneratedTweetMetadata;
}

interface GeneratedTweetsApiResponse {
  success?: boolean;
  agent_id?: string;
  tweets?: RawGeneratedTweet[];
  total_count?: number;
  error_message?: string | null;
  error?: string | null;
}

type AgentSettingsPayload = {
  is_active: boolean;
  daily_tweet_generation: boolean;
  telegram_push_notifications: boolean;
  language: 'en' | 'zh';
};

type AgentSettingsOverrides = Partial<AgentSettingsPayload>;

const agentProfile = {
  name: 'BNBOT AI',
  handle: '@BNBOT_AI',
  verified: true,
  bio: 'Social intelligence co-pilot for crypto teams. Streams Telegram signals into daily tweet strategy.',
  avatar: bnbotAI,
};

const composerTabs = [
  { key: 'result', label: 'Result' },
  { key: 'compose', label: 'Compose' },
] as const;

type ComposerTabKey = (typeof composerTabs)[number]['key'];

const mapAgentStatusLabel = (
  status?: string | null,
  isEnabled?: boolean,
) => {
  if (status === 'generating_character') {
    return 'Generating';
  }

  if (isEnabled === false) {
    return 'Paused';
  }

  return 'Live';
};

const toTrimmedString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const hasDirectTelegramField = (field: unknown): boolean => {
  if (typeof field === 'string') {
    return field.trim().length > 0;
  }
  if (typeof field === 'number') {
    return Number.isFinite(field);
  }
  return false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const firstNonEmptyString = (...values: Array<unknown>): string | null => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
};

const normalizeTweetStatus = (value: unknown): TweetStatus => {
  if (value === 'scheduled' || value === 'published') {
    return value;
  }
  return 'draft';
};

const extractHashtags = (text: string): string[] => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }
  const matches = text.match(/#[A-Za-z0-9_]+/g) ?? [];
  const normalized = matches
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter((tag) => tag.length > 0);
  return Array.from(new Set(normalized)).slice(0, 8);
};

const normalizeTagList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const tags = value
    .map((tag) =>
      typeof tag === 'string' ? tag.replace(/^#/, '').trim() : null,
    )
    .filter((tag): tag is string => Boolean(tag && tag.length > 0));

  return tags.length > 0 ? tags : null;
};

const extractGeneratedTweetContent = (source: unknown): string | null => {
  const pickString = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  };

  const direct = pickString(source);
  if (direct) {
    return direct;
  }

  if (Array.isArray(source)) {
    for (const entry of source) {
      const nested = extractGeneratedTweetContent(entry);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(source)) {
    return null;
  }

  const immediateFields = [
    source.content,
    source.text,
    source.tweet,
    source.tweet_text,
    source.message,
    source.output,
    source.result,
    source.response,
  ];

  for (const field of immediateFields) {
    const candidate = extractGeneratedTweetContent(field);
    if (candidate) {
      return candidate;
    }
  }

  const nestedFields = [source.data, source.messages, source.outputs, source.results];
  for (const field of nestedFields) {
    const candidate = extractGeneratedTweetContent(field);
    if (candidate) {
      return candidate;
    }
  }

  return null;
};

const normalizeGeneratedTweet = (
  raw: RawGeneratedTweet,
  options?: { isNew?: boolean; isLocalOnly?: boolean },
): GeneratedTweet | null => {
  const rawContent =
    typeof raw.content === 'string' ? raw.content.trim() : '';

  if (!rawContent) {
    return null;
  }

  const metadata = isRecord(raw.metadata)
    ? (raw.metadata as GeneratedTweetMetadata)
    : undefined;

  const summary =
    firstNonEmptyString(
      typeof raw.summary === 'string' ? raw.summary : null,
      typeof raw.body === 'string' ? raw.body : null,
      metadata?.summary,
      metadata?.body,
      metadata?.content,
      rawContent,
    ) ?? rawContent;

  const topic =
    firstNonEmptyString(
      typeof raw.topic === 'string' ? raw.topic : null,
      typeof raw.title === 'string' ? raw.title : null,
      typeof raw.headline === 'string' ? raw.headline : null,
      typeof raw.subject === 'string' ? raw.subject : null,
      metadata?.topic,
      metadata?.title,
      metadata?.headline,
      metadata?.subject,
    ) ?? 'Tweet Idea';

  const notes =
    firstNonEmptyString(
      typeof raw.notes === 'string' ? raw.notes : null,
      typeof raw.note === 'string' ? raw.note : null,
      typeof raw.warning === 'string' ? raw.warning : null,
      typeof raw.todo === 'string' ? raw.todo : null,
      metadata?.notes,
      metadata?.note,
      metadata?.warning,
      metadata?.todo,
    ) ?? undefined;

  const metadataTags = metadata ? normalizeTagList(metadata.tags) : null;
  const primaryTags: string[] =
    metadataTags ?? normalizeTagList(raw.tags) ?? extractHashtags(rawContent);

  let createdAt: string | undefined;
  if (typeof raw.created_at === 'string') {
    createdAt = raw.created_at;
  } else if (typeof raw.created_at === 'number' && Number.isFinite(raw.created_at)) {
    createdAt = new Date(raw.created_at).toISOString();
  }

  const parsedTimestamp =
    createdAt && !Number.isNaN(Date.parse(createdAt))
      ? Date.parse(createdAt)
      : Date.now();

  const rawId =
    typeof raw.tweet_id === 'number'
      ? String(raw.tweet_id)
      : firstNonEmptyString(raw.tweet_id);

  const id =
    rawId ?? `local-${parsedTimestamp}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    content: summary,
    publishText: rawContent,
    title: topic,
    tags: primaryTags,
    notes,
    status: normalizeTweetStatus(metadata?.status),
    timestamp: parsedTimestamp,
    createdAt,
    metadata,
    isNew: options?.isNew,
    isLocalOnly: options?.isLocalOnly,
  };
};

const mergeGeneratedTweetCollections = (
  existing: GeneratedTweet[],
  incoming: GeneratedTweet[],
): GeneratedTweet[] => {
  const merged = new Map<string, GeneratedTweet>();

  incoming.forEach((tweet) => {
    merged.set(tweet.id, tweet);
  });

  existing
    .filter((tweet) => tweet.isLocalOnly)
    .forEach((tweet) => {
      if (!merged.has(tweet.id)) {
        merged.set(tweet.id, tweet);
      }
    });

  return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp);
};

export default function XAgentPage() {
  const [userData, setUserData] = useState<Record<string, any> | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [hasOpenedAgentModal, setHasOpenedAgentModal] = useState(false);
  const [showAgentSetupModal, setShowAgentSetupModal] = useState(false);
  const [agentUsernameInput, setAgentUsernameInput] = useState('');
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [isGeneratingTweets, setIsGeneratingTweets] = useState(false);
  const [generatedTweets, setGeneratedTweets] = useState<GeneratedTweet[]>([]);
  const [isLoadingGeneratedTweets, setIsLoadingGeneratedTweets] =
    useState(false);
  const [generatedTweetsError, setGeneratedTweetsError] = useState<
    string | null
  >(null);
  const [activeComposerTab, setActiveComposerTab] =
    useState<ComposerTabKey>('result');
  const [xAgentData, setXAgentData] = useState<Record<string, any> | null>(
    null,
  );
  const [agentLanguage, setAgentLanguage] = useState<'en' | 'zh'>('en');
  const [isFetchingAgent, setIsFetchingAgent] = useState(false);
  const [didSettingsChange, setDidSettingsChange] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [isCharacterModalOpen, setIsCharacterModalOpen] = useState(false);
  const [isUpdatingAgent, setIsUpdatingAgent] = useState(false);
  const settingsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const refreshAgentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const generatedTweetsAbortControllerRef =
    useRef<AbortController | null>(null);
  const componentIsMountedRef = useRef(true);
  const { showNotification } = useNotification();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = localStorage.getItem('userData.bnbot');
      if (stored) {
        setUserData(JSON.parse(stored));
      } else {
        setUserData(null);
      }
    } catch (error) {
      console.error('Failed to parse stored user data:', error);
      setUserData(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const accessToken = localStorage.getItem('accessToken.bnbot');

    if (!accessToken) {
      localStorage.removeItem('xAgentData.bnbot');
      setXAgentData(null);
      return;
    }

    try {
      const storedAgent = localStorage.getItem('xAgentData.bnbot');
      if (storedAgent) {
        setXAgentData(JSON.parse(storedAgent));
      }
    } catch (error) {
      console.error('Failed to parse stored X Agent data:', error);
      localStorage.removeItem('xAgentData.bnbot');
      setXAgentData(null);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) {
      return;
    }

    const isLoggedIn = Boolean(userData || xAgentData);

    if (!isLoggedIn) {
      setShowLoginModal(true);
      setShowAgentSetupModal(false);
      setHasOpenedAgentModal(false);
      return;
    }

    setShowLoginModal(false);

    if (isFetchingAgent && !xAgentData) {
      return;
    }

    if (xAgentData) {
      const rawUsername =
        typeof xAgentData.username === 'string' ? xAgentData.username : '';
      setAgentUsernameInput(rawUsername.replace(/^@/, ''));
      setShowAgentSetupModal(false);
      setHasOpenedAgentModal(true);
      return;
    }

    if (!hasOpenedAgentModal) {
      const rawUsername =
        userData && typeof userData.username === 'string'
          ? userData.username
          : '';
      setAgentUsernameInput(rawUsername.replace(/^@/, ''));
      setShowAgentSetupModal(true);
      setHasOpenedAgentModal(true);
    }
  }, [
    authChecked,
    userData,
    xAgentData,
    hasOpenedAgentModal,
    isFetchingAgent,
  ]);

  useEffect(() => {
    if (!showAgentSetupModal) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showAgentSetupModal]);

  const fetchAgentData = useCallback(async () => {
    if (typeof window === 'undefined' || !authChecked) {
      return;
    }

    const accessToken = localStorage.getItem('accessToken.bnbot');

    if (!accessToken) {
      if (componentIsMountedRef.current) {
        setXAgentData(null);
        setIsFetchingAgent(false);
      }
      return;
    }

    setIsFetchingAgent(true);
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';
      const response = await fetch(`${baseUrl}/api/v1/agents/x-agent`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.status === 404) {
        if (componentIsMountedRef.current) {
          setXAgentData(null);
        }
        return;
      }

      if (response.status === 401) {
        if (componentIsMountedRef.current) {
          setXAgentData(null);
          setUserData(null);
          setShowAgentSetupModal(false);
          setHasOpenedAgentModal(false);
          setShowLoginModal(true);
        }
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken.bnbot');
          localStorage.removeItem('userData.bnbot');
          localStorage.removeItem('xAgentData.bnbot');
        }
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch X Agent. Status: ${response.status}`);
      }

      const data = await response.json();
      if (componentIsMountedRef.current) {
        setXAgentData(data);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('xAgentData.bnbot', JSON.stringify(data));
          } catch (storageError) {
            console.error(
              'Failed to persist X Agent data in localStorage:',
              storageError,
            );
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch X Agent:', error);
      if (componentIsMountedRef.current) {
        setXAgentData(null);
      }
    } finally {
      if (componentIsMountedRef.current) {
        setIsFetchingAgent(false);
      }
    }
  }, [
    authChecked,
    setUserData,
    setShowAgentSetupModal,
    setHasOpenedAgentModal,
    setShowLoginModal,
  ]);

  useEffect(() => {
    fetchAgentData();
  }, [fetchAgentData]);

  useEffect(() => {
    return () => {
      componentIsMountedRef.current = false;
      if (settingsSaveTimeoutRef.current) {
        clearTimeout(settingsSaveTimeoutRef.current);
        settingsSaveTimeoutRef.current = null;
      }
      if (refreshAgentTimeoutRef.current) {
        clearTimeout(refreshAgentTimeoutRef.current);
        refreshAgentTimeoutRef.current = null;
      }
      if (generatedTweetsAbortControllerRef.current) {
        generatedTweetsAbortControllerRef.current.abort();
        generatedTweetsAbortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!xAgentData) {
      setAgentEnabled(true);
      setTelegramConnected(false);
      setAgentLanguage('en');
      setDidSettingsChange(false);
      setSettingsError(null);
      setSettingsSaved(false);
      return;
    }

    if (typeof xAgentData.is_active === 'boolean') {
      setAgentEnabled(xAgentData.is_active);
    }

    if (typeof xAgentData.language === 'string') {
      const normalized = xAgentData.language.trim().toLowerCase();
      setAgentLanguage(normalized === 'zh' ? 'zh' : 'en');
    } else {
      setAgentLanguage('en');
    }

    const agentRecord = xAgentData as Record<string, unknown>;

    const candidateAgentIds = new Set<string>();
    [
      'id',
      'agent_id',
      'agentId',
      'x_agent_id',
      'xAgentId',
      'telegram_agent_id',
      'telegramAgentId',
    ].forEach((key) => {
      const value = agentRecord[key];
      const normalizedStringValue = toTrimmedString(value);
      const normalizedNumberValue = toFiniteNumber(value);
      const normalized =
        normalizedStringValue ??
        (normalizedNumberValue !== null ? String(normalizedNumberValue) : null);
      if (normalized) {
        candidateAgentIds.add(normalized);
      }
    });

    let hasTelegramBinding =
      hasDirectTelegramField(agentRecord.telegram_chat_id) ||
      hasDirectTelegramField(agentRecord.telegram_user_id) ||
      hasDirectTelegramField(agentRecord.telegram_username);

    const seenObjects = new WeakSet<object>();
    const matchesAgentBinding = (binding: unknown): boolean => {
      if (!binding || typeof binding !== 'object') {
        return false;
      }
      const record = binding as Record<string, unknown>;

      const bindingAgentCandidates: Array<string | null> = [
        toTrimmedString(record.agent_id) ??
          (toFiniteNumber(record.agent_id) !== null
            ? String(toFiniteNumber(record.agent_id))
            : null),
        toTrimmedString(record.agentId) ??
          (toFiniteNumber(record.agentId) !== null
            ? String(toFiniteNumber(record.agentId))
            : null),
        toTrimmedString(record.agent) ??
          (toFiniteNumber(record.agent) !== null
            ? String(toFiniteNumber(record.agent))
            : null),
        toTrimmedString(record.agent_uuid) ??
          (toFiniteNumber(record.agent_uuid) !== null
            ? String(toFiniteNumber(record.agent_uuid))
            : null),
        toTrimmedString(record.x_agent_id) ??
          (toFiniteNumber(record.x_agent_id) !== null
            ? String(toFiniteNumber(record.x_agent_id))
            : null),
        toTrimmedString(record.xAgentId) ??
          (toFiniteNumber(record.xAgentId) !== null
            ? String(toFiniteNumber(record.xAgentId))
            : null),
      ];

      const bindingAgentIds = bindingAgentCandidates
        .filter(Boolean)
        .map((value) => value as string);

      if (bindingAgentIds.length > 0 && candidateAgentIds.size > 0) {
        const matches = bindingAgentIds.some((id) =>
          candidateAgentIds.has(id),
        );
        if (!matches) {
          return false;
        }
      } else if (bindingAgentIds.length > 0 && candidateAgentIds.size === 0) {
        bindingAgentIds.forEach((id) => candidateAgentIds.add(id));
      }

      const hasTelegramIdentifiers = [
        record.telegram_chat_id,
        record.chat_id,
        record.chatId,
        record.telegram_user_id,
        record.user_id,
        record.userId,
        record.telegram_username,
        record.username,
        record.handle,
      ].some(hasDirectTelegramField);

      return hasTelegramIdentifiers;
    };

    const evaluateBindingSource = (source: unknown): boolean => {
      if (!source) {
        return false;
      }

      if (Array.isArray(source)) {
        return source.some((entry) => evaluateBindingSource(entry));
      }

      if (typeof source === 'object') {
        if (seenObjects.has(source as object)) {
          return false;
        }
        seenObjects.add(source as object);

        if (matchesAgentBinding(source)) {
          return true;
        }

        const nestedValues = Object.values(source as Record<string, unknown>);
        return nestedValues.some((value) => evaluateBindingSource(value));
      }

      return false;
    };

    if (!hasTelegramBinding) {
      const bindingSources: unknown[] = [
        agentRecord.telegram_binding,
        agentRecord.telegram_bindings,
        agentRecord.telegramBinding,
        agentRecord.telegramBindings,
        agentRecord.telegramConnections,
        agentRecord.telegram_connections,
        agentRecord.telegram_accounts,
        agentRecord.telegramAccounts,
      ];

      const integrations = agentRecord.integrations as
        | Record<string, unknown>
        | undefined;
      if (integrations) {
        bindingSources.push(integrations.telegram);
        if (Array.isArray(integrations)) {
          bindingSources.push(integrations);
        }
      }

      hasTelegramBinding = bindingSources.some((source) =>
        evaluateBindingSource(source),
      );
    }

    setTelegramConnected(hasTelegramBinding);

    setDidSettingsChange(false);
    setSettingsError(null);
    setSettingsSaved(false);
  }, [xAgentData]);

  const handleLoginModalClose = useCallback(() => {
    if (!userData) {
      return;
    }

    setShowLoginModal(false);
  }, [userData]);

  const handleAgentSetupSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmedUsername = agentUsernameInput.trim().replace(/^@/, '');

      if (!trimmedUsername) {
        showNotification({
          title: 'Username required',
          msg: '请输入你的 X 用户名以继续生成专属 Agent。',
          type: 'warning',
          icon: <span>!</span>,
        });
        return;
      }

      const accessToken =
        typeof window !== 'undefined'
          ? localStorage.getItem('accessToken.bnbot')
          : null;

      if (!accessToken) {
        showNotification({
          title: '登录后继续',
          msg: '请先登录以创建你的 X Agent。',
          type: 'warning',
          icon: <span>!</span>,
        });
        setShowLoginModal(true);
        return;
      }

      setIsCreatingAgent(true);

      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';
        const response = await fetch(`${baseUrl}/api/v1/agents/create-x-agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ username: trimmedUsername }),
        });

        let data: Record<string, any> | null = null;
        try {
          data = await response.json();
        } catch (parseError) {
          console.error('Failed to parse create X Agent response:', parseError);
        }

        if (!response.ok) {
          const errorMessage =
            (data && (data.error || data.message)) ||
            '创建 X Agent 失败，请稍后再试。';
          showNotification({
            title: '创建失败',
            msg: errorMessage,
            type: 'error',
            icon: <span>✕</span>,
          });
          return;
        }

        setAgentUsernameInput(trimmedUsername);

        if (data) {
          setXAgentData(data);
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('xAgentData.bnbot', JSON.stringify(data));
            } catch (storageError) {
              console.error(
                'Failed to persist X Agent data in localStorage:',
                storageError,
              );
            }
          }
        }

        const isGenerating = data?.status === 'generating_character';
        showNotification({
          title: isGenerating ? '正在生成 X Agent' : 'X Agent 已创建',
          msg: isGenerating
            ? `我们正在为 @${trimmedUsername} 构建专属配置。`
            : `@${trimmedUsername} 的专属 X Agent 已就绪。`,
          type: 'success',
          icon: <span>✓</span>,
        });
        setHasOpenedAgentModal(true);
        setShowAgentSetupModal(false);
      } catch (error) {
        console.error('Failed to create X Agent:', error);
        showNotification({
          title: '创建失败',
          msg: '创建 X Agent 失败，请稍后再试。',
          type: 'error',
          icon: <span>✕</span>,
        });
      } finally {
        setIsCreatingAgent(false);
      }
    },
    [agentUsernameInput, showNotification],
  );

  const persistAgentSettings = useCallback(async () => {
    if (!xAgentData) {
      return;
    }

    settingsSaveTimeoutRef.current = null;

    const accessToken =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken.bnbot')
        : null;

    if (!accessToken) {
      setSettingsError('登录已过期，请重新登录。');
      setShowLoginModal(true);
      setUserData(null);
      setDidSettingsChange(false);
      setSettingsSaved(false);
      return;
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';

    const payload: Record<string, any> = {
      is_active: agentEnabled,
    };
    payload.language = agentLanguage;

    setIsSavingSettings(true);
    setSettingsError(null);

    try {
      const response = await fetch(`${baseUrl}/api/v1/agents/x-agent`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        setSettingsError('登录已过期，请重新登录。');
        showNotification({
          title: '登录已过期',
          msg: '请重新登录以继续管理 X Agent 设置。',
          type: 'warning',
          icon: <span>!</span>,
        });

        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken.bnbot');
          localStorage.removeItem('userData.bnbot');
          localStorage.removeItem('xAgentData.bnbot');
        }

        setUserData(null);
        setXAgentData(null);
        setShowAgentSetupModal(false);
        setHasOpenedAgentModal(false);
        setShowLoginModal(true);
        setDidSettingsChange(false);
        setSettingsSaved(false);
        return;
      }

      if (response.status === 404) {
        setSettingsError('尚未创建 X Agent。');
        setDidSettingsChange(false);
        setXAgentData(null);
        setSettingsSaved(false);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Failed to update X Agent settings. Status: ${response.status}. ${errorText}`,
        );
      }

      let updatedAgent: Record<string, any> | null = null;
      try {
        updatedAgent = await response.json();
      } catch (parseError) {
        // Some responses may not include a JSON body; fallback to merged payload.
      }

      const mergedAgent = {
        ...xAgentData,
        is_active: agentEnabled,
        language: agentLanguage,
        ...(updatedAgent ?? {}),
      };

      setXAgentData(mergedAgent);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('xAgentData.bnbot', JSON.stringify(mergedAgent));
        } catch (storageError) {
          console.error(
            'Failed to persist updated X Agent data:',
            storageError,
          );
        }
      }

      setDidSettingsChange(false);
      setSettingsSaved(true);
    } catch (error) {
      console.error('Failed to update X Agent settings:', error);
      setSettingsError('保存设置失败，请稍后重试。');
      setSettingsSaved(false);
      showNotification({
        title: '保存失败',
        msg: '保存 X Agent 设置失败，请稍后重试。',
        type: 'error',
        icon: <span>✕</span>,
      });
    } finally {
      setIsSavingSettings(false);
    }
  }, [
    xAgentData,
    agentEnabled,
    agentLanguage,
    showNotification,
    setShowLoginModal,
    setUserData,
    setShowAgentSetupModal,
    setHasOpenedAgentModal,
    setSettingsError,
    setDidSettingsChange,
    setXAgentData,
    setIsSavingSettings,
    settingsSaveTimeoutRef,
  ]);

  useEffect(() => {
    if (!xAgentData || !didSettingsChange) {
      return;
    }

    if (settingsSaveTimeoutRef.current) {
      clearTimeout(settingsSaveTimeoutRef.current);
      settingsSaveTimeoutRef.current = null;
    }

    settingsSaveTimeoutRef.current = setTimeout(() => {
      void persistAgentSettings();
    }, 5000);

    return () => {
      if (settingsSaveTimeoutRef.current) {
        clearTimeout(settingsSaveTimeoutRef.current);
        settingsSaveTimeoutRef.current = null;
      }
    };
  }, [
    agentEnabled,
    agentLanguage,
    xAgentData,
    didSettingsChange,
    persistAgentSettings,
  ]);

  const handleToggleAgentEnabled = useCallback(
    (value: boolean) => {
      if (!xAgentData || value === agentEnabled) {
        return;
      }
      setSettingsError(null);
      setAgentEnabled(value);
      setDidSettingsChange(true);
      setSettingsSaved(false);
    },
    [
      xAgentData,
      agentEnabled,
      setSettingsError,
      setAgentEnabled,
      setDidSettingsChange,
    ],
  );


  const handleLanguageChange = useCallback(
    async (value: 'en' | 'zh') => {
      if (!xAgentData || value === agentLanguage) {
        return;
      }
      setSettingsError(null);
      setAgentLanguage(value);
      setIsSavingSettings(true);

      try {
        const accessToken =
          typeof window !== 'undefined'
            ? localStorage.getItem('accessToken.bnbot')
            : null;

        if (!accessToken) {
          setSettingsError('登录已过期，请重新登录。');
          setShowLoginModal(true);
          setUserData(null);
          return;
        }

        const baseUrl =
          process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';

        const payload: Record<string, any> = {
          is_active: agentEnabled,
          language: value,
        };

        const response = await fetch(`${baseUrl}/api/v1/agents/x-agent`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 401) {
          setSettingsError('登录已过期，请重新登录。');
          showNotification({
            title: '登录已过期',
            msg: '请重新登录以继续管理 X Agent 设置。',
            type: 'warning',
            icon: <span>!</span>,
          });

          if (typeof window !== 'undefined') {
            localStorage.removeItem('accessToken.bnbot');
            localStorage.removeItem('userData.bnbot');
            localStorage.removeItem('xAgentData.bnbot');
          }

          setUserData(null);
          setXAgentData(null);
          setShowAgentSetupModal(false);
          setHasOpenedAgentModal(false);
          setShowLoginModal(true);
          return;
        }

        if (response.status === 404) {
          setSettingsError('尚未创建 X Agent。');
          return;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(
            `Failed to update X Agent settings. Status: ${response.status}. ${errorText}`,
          );
        }

        let updatedAgent: Record<string, any> | null = null;
        try {
          updatedAgent = await response.json();
        } catch (parseError) {
          // Some responses may not include a JSON body; fallback to merged payload.
        }

        const mergedAgent = {
          ...xAgentData,
          is_active: agentEnabled,
          language: value,
          ...(updatedAgent ?? {}),
        };

        setXAgentData(mergedAgent);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('xAgentData.bnbot', JSON.stringify(mergedAgent));
          } catch (storageError) {
            console.error(
              'Failed to persist updated X Agent data:',
              storageError,
            );
          }
        }

        setSettingsSaved(true);
      } catch (error) {
        console.error('Failed to update language setting:', error);
        const message =
          error instanceof Error ? error.message : '更新语言设置失败，请稍后重试。';
        setSettingsError(message);
      } finally {
        setIsSavingSettings(false);
      }
    },
    [
      xAgentData,
      agentLanguage,
      agentEnabled,
      showNotification,
      setShowLoginModal,
      setUserData,
      setShowAgentSetupModal,
      setHasOpenedAgentModal,
      setXAgentData,
    ],
  );

  const isAuthenticated = Boolean(userData || xAgentData);
  const agentStatusLabel = mapAgentStatusLabel(
    xAgentData?.status,
    agentEnabled,
  );
  const rawAgentName =
    typeof xAgentData?.name === 'string' ? xAgentData.name : '';
  const agentDisplayName = rawAgentName
    ? rawAgentName.replace(/^X[_\s-]*Agent[_\s-]*/i, '').trim() ||
      agentProfile.name
    : agentProfile.name;
  const agentHandle = xAgentData?.username
    ? `@${xAgentData.username.replace(/^@/, '')}`
    : agentProfile.handle;
  const agentAvatarFromApi =
    typeof xAgentData?.avatar === 'string' ? xAgentData.avatar.trim() : '';
  const agentAvatar: string | StaticImageData = agentAvatarFromApi
    ? agentAvatarFromApi
    : agentProfile.avatar;
  const agentBanner =
    typeof xAgentData?.banner === 'string'
      ? xAgentData.banner.trim() || null
      : null;
  const agentBio =
    typeof xAgentData?.description === 'string'
      ? xAgentData.description.trim() || agentProfile.bio
      : agentProfile.bio;
  const characterPayload: CharacterPayload | null =
    xAgentData &&
    typeof xAgentData.character === 'object' &&
    xAgentData.character !== null
      ? (xAgentData.character as CharacterPayload)
      : null;
  const agentAvatarKey =
    typeof agentAvatar === 'string' ? agentAvatar : 'default-agent-avatar';
  const isAgentAvatarRemote = typeof agentAvatar === 'string';
  const agentLabel = 'X Agent';
  const agentTitle = `${agentLabel} ${agentHandle}`;
  const resolvedAgentId =
    toTrimmedString(xAgentData?.id) ??
    toTrimmedString(xAgentData?.agent_id) ??
    toTrimmedString(xAgentData?.agentId) ??
    toTrimmedString(xAgentData?.x_agent_id) ??
    toTrimmedString(xAgentData?.xAgentId) ??
    toTrimmedString(userData?.x_agent_id) ??
    toTrimmedString(userData?.agent_id) ??
    toTrimmedString(userData?.agentId) ??
    (toFiniteNumber(xAgentData?.id) !== null
      ? String(toFiniteNumber(xAgentData?.id))
      : null) ??
    (toFiniteNumber(xAgentData?.agent_id) !== null
      ? String(toFiniteNumber(xAgentData?.agent_id))
      : null) ??
    (toFiniteNumber(xAgentData?.x_agent_id) !== null
      ? String(toFiniteNumber(xAgentData?.x_agent_id))
      : null);
  const fallbackAgentId = 'xagent_pub_f147fca76bc24302';
  const boundAgentId = resolvedAgentId ?? fallbackAgentId;
  const isAgentSectionLoading =
    (!authChecked && !xAgentData) || (isFetchingAgent && !xAgentData);
  const tweetSkeletonPlaceholders = Array.from({ length: 4 });
  const showTweetSkeleton =
    isAgentSectionLoading ||
    (isLoadingGeneratedTweets && generatedTweets.length === 0);
  const shouldShowResultSkeleton =
    activeComposerTab === 'result' && showTweetSkeleton;

  const {
    isLoading: isTelegramLoading,
    error: telegramError,
    requestBindingCode,
  } = useTelegramBinding({
    agentId: boundAgentId,
    onSuccess: (data) => {
      setTelegramConnected(true);
      showNotification({
        title: 'Telegram Connected!',
        msg: `Binding code: ${data.binding_code}. Code expires in ${data.expires_in} seconds.`,
        type: 'success',
        icon: <span>✓</span>,
      });
    },
    onError: (error) => {
      showNotification({
        title: 'Connection Failed',
        msg: error,
        type: 'error',
        icon: <span>✕</span>,
      });
    },
  });

  const handleTelegramConnect = useCallback(async () => {
    try {
      await requestBindingCode();
    } catch (err) {
      // Error is already handled in the hook and notification
      console.error('Telegram binding error:', err);
    }
  }, [requestBindingCode]);

  const fetchGeneratedTweets = useCallback(async () => {
    if (!boundAgentId) {
      return;
    }

    if (generatedTweetsAbortControllerRef.current) {
      generatedTweetsAbortControllerRef.current.abort();
    }

    const accessToken =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken.bnbot')
        : null;

    if (!accessToken) {
      setGeneratedTweetsError('Please log in to view generated tweets.');
      setGeneratedTweets([]);
      setIsLoadingGeneratedTweets(false);
      return;
    }

    const controller = new AbortController();
    generatedTweetsAbortControllerRef.current = controller;

    setIsLoadingGeneratedTweets(true);
    setGeneratedTweetsError(null);

    try {
      const backendBase = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;

      if (!backendBase) {
        throw new Error('缺少 NEXT_PUBLIC_REST_API_ENDPOINT 配置，无法获取推文。');
      }

      const normalizedBase = backendBase.endsWith('/')
        ? backendBase.slice(0, -1)
        : backendBase;
      const backendUrl = `${normalizedBase}/api/v1/agents/${encodeURIComponent(boundAgentId)}/generated-tweets?limit=100`;

      const response = await fetch(backendUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const rawBody = await response.text();
      let payload: GeneratedTweetsApiResponse | null = null;

      if (rawBody) {
        try {
          payload = JSON.parse(rawBody) as GeneratedTweetsApiResponse;
        } catch (parseError) {
          console.error(
            'Failed to parse generated tweets payload',
            parseError,
          );
        }
      }

      if (!response.ok) {
        const message =
          firstNonEmptyString(
            payload?.error,
            payload?.error_message,
          ) ?? 'Unable to fetch generated tweets, please try again later.';
        throw new Error(message);
      }

      const normalizedTweets = Array.isArray(payload?.tweets)
        ? (payload!.tweets
            .map((tweet) => normalizeGeneratedTweet(tweet))
            .filter(Boolean) as GeneratedTweet[])
        : [];

      setGeneratedTweets((prev) =>
        mergeGeneratedTweetCollections(prev, normalizedTweets),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to fetch generated tweets, please try again later.';
      setGeneratedTweetsError(message);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingGeneratedTweets(false);
      }
    }
  }, [boundAgentId]);

  useEffect(() => {
    void fetchGeneratedTweets();
  }, [fetchGeneratedTweets]);

  const handleGenerateMoreTweets = useCallback(async () => {
    if (!boundAgentId) {
      showNotification({
        title: '无法生成推文',
        msg: '缺少 Agent ID，请稍后重试。',
        type: 'error',
      });
      return;
    }

    const accessToken =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken.bnbot')
        : null;

    if (!accessToken) {
      setShowLoginModal(true);
      showNotification({
        title: '请先登录',
        msg: '生成推文前请先登录。',
        type: 'warning',
      });
      return;
    }

    setIsGeneratingTweets(true);
    try {
      const backendBase = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;

      if (!backendBase) {
        throw new Error('缺少 NEXT_PUBLIC_REST_API_ENDPOINT 配置，无法生成推文。');
      }

      const normalizedBase = backendBase.endsWith('/')
        ? backendBase
        : `${backendBase}/`;
      const backendUrl = new URL(
        '/api/v1/agents/generate-tweet',
        normalizedBase,
      );
      backendUrl.searchParams.set('agent_id', boundAgentId);

      const response = await fetch(backendUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const rawBody = await response.text();
      let payload: unknown = null;

      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch (parseError) {
          console.error(
            'Failed to parse generate tweet payload',
            parseError,
          );
          payload = rawBody;
        }
      }

      if (!response.ok) {
        const payloadRecord = isRecord(payload) ? payload : null;
        const errorMessage =
          firstNonEmptyString(
            payloadRecord ? payloadRecord['error'] : null,
            payloadRecord ? payloadRecord['error_message'] : null,
            payloadRecord ? payloadRecord['message'] : null,
            typeof payload === 'string' ? payload : null,
          ) ?? 'Failed to generate tweet';

        throw new Error(errorMessage);
      }

      const rootPayloadRecord = isRecord(payload) ? payload : null;
      const payloadRecord =
        rootPayloadRecord && isRecord(rootPayloadRecord['tweet'])
          ? (rootPayloadRecord['tweet'] as Record<string, unknown>)
          : rootPayloadRecord &&
              Array.isArray(rootPayloadRecord['tweets'])
            ? ((rootPayloadRecord['tweets'] as unknown[]).find(isRecord) as
                | Record<string, unknown>
                | undefined) ?? rootPayloadRecord
            : rootPayloadRecord;

      const tweetSources: Record<string, unknown>[] =
        Array.isArray(rootPayloadRecord?.tweets) &&
        rootPayloadRecord!.tweets.some(isRecord)
          ? (rootPayloadRecord!.tweets.filter(
              (tweet): tweet is Record<string, unknown> => isRecord(tweet),
            ) as Record<string, unknown>[])
          : payloadRecord
            ? [payloadRecord]
            : [];

      if (tweetSources.length === 0) {
        const tweetContentSource =
          payloadRecord ?? rootPayloadRecord ?? payload ?? null;
        const tweetContent = extractGeneratedTweetContent(tweetContentSource);

        if (tweetContent) {
          tweetSources.push({
            content: tweetContent,
          });
        }
      }

      if (tweetSources.length === 0) {
        const successMessage =
          firstNonEmptyString(
            rootPayloadRecord ? rootPayloadRecord['message'] : null,
            rootPayloadRecord ? rootPayloadRecord['status'] : null,
            rootPayloadRecord ? rootPayloadRecord['detail'] : null,
          ) ?? '推文生成任务已触发，请稍后查看。';

        showNotification({
          title: '生成中',
          msg: successMessage,
          type: 'info',
        });

        return;
      }

      const normalizedTweets: GeneratedTweet[] = [];

      tweetSources.forEach((source, index) => {
        const metadataValue = isRecord(source.metadata)
          ? (source.metadata as GeneratedTweetMetadata)
          : undefined;

        const tweetContent = extractGeneratedTweetContent(source);

        if (!tweetContent) {
          return;
        }

        const rawTweet: RawGeneratedTweet = {
          tweet_id:
            toTrimmedString(source.tweet_id) ??
            toTrimmedString(source.id) ??
            toTrimmedString(source.tweetId) ??
            `local-${Date.now()}-${index}`,
          content: tweetContent,
          created_at:
            toTrimmedString(source.created_at) ?? new Date().toISOString(),
          metadata: metadataValue,
          topic: source.topic,
          title: source.title,
          headline: source.headline,
          subject: source.subject,
          summary: source.summary,
          body: source.body,
          notes: source.notes,
        };

        const normalized = normalizeGeneratedTweet(rawTweet, {
          isNew: true,
          isLocalOnly: true,
        });

        if (normalized) {
          normalizedTweets.push(normalized);
        }
      });

      if (normalizedTweets.length > 0) {
        const normalizedIds = new Set(normalizedTweets.map((tweet) => tweet.id));

        setGeneratedTweets((prev) => [...normalizedTweets, ...prev]);

        setTimeout(() => {
          setGeneratedTweets((prev) =>
            prev.map((tweet) =>
              normalizedIds.has(tweet.id) ? { ...tweet, isNew: false } : tweet,
            ),
          );
        }, 5000);

      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '生成推文失败，请稍后重试。';
      showNotification({
        title: '生成失败',
        msg: message,
        type: 'error',
      });
      console.error('Error generating tweet:', error);
    } finally {
      setIsGeneratingTweets(false);
    }
  }, [boundAgentId, setShowLoginModal, showNotification]);

  const handlePublishTweet = (content: string) => {
    const tweetText = encodeURIComponent(content);
    const twitterUrl = `https://x.com/intent/post?text=${tweetText}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCharacterModalOpen = useCallback(() => {
    if (isAgentSectionLoading) {
      return;
    }
    setIsCharacterModalOpen(true);
  }, [isAgentSectionLoading]);

  const handleCharacterModalClose = useCallback(() => {
    setIsCharacterModalOpen(false);
  }, []);

  const handleAgentUpdate = useCallback(
    async (payload: UpdateAgentPayload) => {
      if (typeof window === 'undefined') {
        throw new Error('无法执行更新：缺少浏览器环境。');
      }

      const accessToken = localStorage.getItem('accessToken.bnbot');

      if (!accessToken) {
        setShowLoginModal(true);
        throw new Error('请先登录后再保存更改。');
      }

      setIsUpdatingAgent(true);

      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';
        const response = await fetch(`${baseUrl}/api/v1/agents/x-agent`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 401) {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('accessToken.bnbot');
            localStorage.removeItem('userData.bnbot');
            localStorage.removeItem('xAgentData.bnbot');
          }
          setUserData(null);
          setXAgentData(null);
          setShowLoginModal(true);
          setShowAgentSetupModal(false);
          setHasOpenedAgentModal(false);
          throw new Error('登录状态已过期，请重新登录。');
        }

        if (response.status === 404) {
          throw new Error('尚未创建 X Agent，无法更新。');
        }

        if (!response.ok) {
          let errorMessage = `更新失败（${response.status}）`;
          try {
            const errorBody = await response.json();
            errorMessage =
              errorBody?.detail || errorBody?.message || errorMessage;
          } catch (parseError) {
            const fallbackText = await response.text();
            if (fallbackText) {
              errorMessage = `${errorMessage}: ${fallbackText}`;
            }
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        if (componentIsMountedRef.current) {
          setXAgentData(data);
        }
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('xAgentData.bnbot', JSON.stringify(data));
          } catch (storageError) {
            console.error('Failed to persist updated X Agent data:', storageError);
          }
        }

        showNotification({
          title: 'Agent 已更新',
          msg: '更改已保存，将在 5 秒内自动刷新。',
          type: 'success',
        });

        if (refreshAgentTimeoutRef.current) {
          clearTimeout(refreshAgentTimeoutRef.current);
        }
        refreshAgentTimeoutRef.current = setTimeout(() => {
          fetchAgentData();
        }, 5000);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '更新 X Agent 失败，请稍后重试。';
        showNotification({
          title: '更新失败',
          msg: message,
          type: 'error',
        });
        throw error;
      } finally {
        if (componentIsMountedRef.current) {
          setIsUpdatingAgent(false);
        }
      }
    },
    [
      fetchAgentData,
      showNotification,
      setUserData,
      setXAgentData,
      setShowLoginModal,
      setShowAgentSetupModal,
      setHasOpenedAgentModal,
    ],
  );

  return (
    <div className="relative">
      <LoginModal isOpen={showLoginModal} onClose={handleLoginModalClose} />
      <CharacterDetailsModal
        open={isCharacterModalOpen}
        onClose={handleCharacterModalClose}
        agentName={agentDisplayName}
        agentHandle={agentHandle}
        avatar={agentAvatar}
        isAvatarRemote={isAgentAvatarRemote}
        banner={agentBanner}
        character={characterPayload}
        agentData={xAgentData}
        onSubmit={handleAgentUpdate}
        isSubmitting={isUpdatingAgent}
      />

      {showAgentSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1419]/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[24px] border border-black/10 bg-white/95 p-8 shadow-[0_24px_64px_-32px_rgba(15,20,25,0.65)] dark:border-white/10 dark:bg-[#10171e]/95 dark:text-white sm:p-9">
            <header className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-black px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-white dark:bg-white/10 dark:text-white/90">
                BNBot
              </span>
              <div className="space-y-2">
                <h2 className="text-[22px] font-semibold text-black/90 dark:text-white">
                  Create Your X Agent
                </h2>
                <p className="text-xs leading-6 text-black/60 dark:text-white/70">
                  Enter your X handle to unlock a personalized copilot that
                  tracks trends, drafts content, and optimizes your posting
                  flow.
                </p>
              </div>
            </header>

            <form onSubmit={handleAgentSetupSubmit} className="mt-8 space-y-6">
              <div className="space-y-3">
                <label
                  htmlFor="agent-username"
                  className="text-xs font-semibold tracking-[0.18em] text-black/50 dark:text-white/50"
                >
                  X Handle
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-5 flex items-center text-base font-semibold text-gray-400 dark:text-white/50">
                    @
                  </span>
                  <input
                    id="agent-username"
                    type="text"
                    autoComplete="off"
                    autoFocus
                    value={agentUsernameInput}
                    onChange={(event) =>
                      setAgentUsernameInput(
                        event.target.value.replace(/^@/, ''),
                      )
                    }
                    className="block h-14 w-full rounded-2xl border-2 border-gray-200 bg-white pl-12 pr-6 text-base text-gray-900 transition-colors duration-200 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-0 dark:border-white/15 dark:bg-[#161d27] dark:text-white dark:placeholder:text-white/40 dark:focus:border-white"
                    placeholder="cz_binance"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  type="submit"
                  fullWidth
                  className="h-12 rounded-[18px] bg-black text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
                  isLoading={isCreatingAgent}
                  disabled={isCreatingAgent}
                >
                  {isCreatingAgent ? 'Creating…' : 'Create'}
                </Button>
                <p className="text-center text-[13px] text-black/40 dark:text-white/40">
                  You can revisit settings anytime to tweak your agent profile.
                </p>
              </div>
            </form>
          </div>
        </div>
      )}

      {authChecked && !isAuthenticated && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 px-4 backdrop-blur xl:left-[22.5rem] 2xl:left-[23.5rem]">
          <div className="max-w-sm rounded-3xl border border-white/60 bg-white/80 p-6 text-center shadow-xl dark:border-gray-700/60 dark:bg-gray-900/70">
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              登录后继续
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              请先登录以解锁 X Agent 的智能功能。
            </p>
            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              登录窗口已经弹出，如果未显示请检查浏览器弹窗设置。
            </p>
          </div>
        </div>
      )}

      <div
        className={cn(
          'mx-auto flex max-w-7xl flex-col gap-6 py-4 lg:flex-row lg:py-6 xl:gap-8',
          authChecked &&
            !isAuthenticated &&
            'pointer-events-none select-none opacity-40 blur-sm',
        )}
      >
        <section className="w-full shrink-0 space-y-6 lg:sticky lg:top-4 lg:max-w-sm xl:max-w-md">
          {isAgentSectionLoading ? (
            <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-[#000000]">
              <div className="animate-pulse">
                <div className="relative h-28 w-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                  <span className="absolute right-5 top-5 inline-flex h-6 w-16 items-center justify-center rounded-full bg-white/20 text-xs font-semibold uppercase tracking-[0.22em] text-transparent">
                    load
                  </span>
                </div>
                <div className="relative z-10 -mt-12 space-y-6 px-6 pb-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 shrink-0 rounded-full border-4 border-white bg-gray-200 dark:border-[#10171e] dark:bg-gray-700" />
                      <div className="space-y-2">
                        <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                        <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCharacterModalOpen}
              className="group block w-full overflow-hidden rounded-3xl border border-gray-200 bg-white text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 dark:border-gray-700 dark:bg-[#000000] dark:focus-visible:ring-white dark:focus-visible:ring-offset-[#050505]"
              aria-label="View X Agent character details"
            >
              <div className="relative h-28 w-full overflow-hidden">
                {agentBanner ? (
                  <>
                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${agentBanner})` }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/40 to-black/85" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0f1419] via-[#1f2933] to-[#111827] dark:from-[#0f1419] dark:via-[#1b2230] dark:to-[#0b1017]" />
                )}
                <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white backdrop-blur-sm transition group-hover:bg-white/20">
                  {agentStatusLabel}
                </span>
              </div>
              <div className="relative z-10 -mt-12 space-y-6 px-6 pb-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative h-16 w-16 shrink-0">
                      <div className="relative h-full w-full overflow-hidden rounded-full border-4 border-white bg-white dark:border-[#10171e]">
                        <Image
                          key={`${agentAvatarKey}-profile`}
                          src={agentAvatar}
                          alt={agentTitle}
                          fill
                          sizes="64px"
                          className="rounded-full object-cover"
                          priority
                          unoptimized={isAgentAvatarRemote}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-md font-semibold text-white">
                        <span>{agentLabel}</span>{' '}
                        <span className="font-medium text-white ">
                          {agentHandle}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {agentBio}
                </p>
              </div>
            </button>
          )}
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-[#000000]">
            {isAgentSectionLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-48 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="h-9 w-32 rounded-full bg-gray-200 dark:bg-gray-700" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      Connect Telegram
                    </h2>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Once connected, X Agent can sync community feedback and
                      send daily tweet previews in Telegram.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {telegramConnected ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800">
                        ✓ Connected
                      </span>
                    ) : (
                      <Button
                        onClick={handleTelegramConnect}
                        disabled={isTelegramLoading}
                        className={`bg-[#229ED9] !px-4 pb-2 pt-2.5 text-white hover:bg-[#1a8cbf] ${
                          isTelegramLoading ? 'cursor-not-allowed opacity-75' : ''
                        }`}
                      >
                        <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
                          {isTelegramLoading ? (
                            <>
                              <svg
                                className="h-5 w-5 animate-spin"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                ></circle>
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                ></path>
                              </svg>
                              <span>Connecting...</span>
                            </>
                          ) : (
                            <>
                              <svg
                                viewBox="0 0 24 24"
                                className="h-5 w-5 flex-shrink-0"
                                fill="currentColor"
                              >
                                <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" />
                              </svg>
                              <span>Connect</span>
                            </>
                          )}
                        </div>
                      </Button>
                    )}
                  </div>
                  {telegramError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/20 dark:bg-red-900/20 dark:text-red-400">
                      <span className="font-medium">Error:</span> {telegramError}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div
            id="x-agent-settings"
            className="space-y-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-[#000000]"
          >
            {isAgentSectionLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="space-y-2">
                  <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-56 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`settings-skeleton-${index}`}
                    className="h-16 rounded-2xl bg-gray-200 dark:bg-gray-800"
                  />
                ))}
                <div className="h-20 rounded-2xl bg-gray-200 dark:bg-gray-800" />
              </div>
            ) : (
              <>
                <header className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      X Agent Settings
                    </h2>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Control X Agent automation behavior and notification
                      preferences
                    </p>
                  </div>
                  <div className="mt-1 flex min-h-[1.25rem] items-center">
                    {settingsError ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 8v4" />
                          <path d="M12 16h.01" />
                        </svg>
                        <span>{settingsError}</span>
                      </span>
                    ) : isSavingSettings ? (
                      <span className="inline-flex items-center text-gray-500 dark:text-gray-400">
                        <svg
                          className="h-4 w-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        <span className="sr-only">Saving settings</span>
                      </span>
                    ) : settingsSaved ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="currentColor"
                        >
                          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.59 7.41-5.3 5.3a1 1 0 0 1-1.42 0l-2.17-2.18 1.42-1.41 1.46 1.46 4.59-4.59 1.42 1.42z" />
                        </svg>
                        <span>Saved</span>
                      </span>
                    ) : null}
                  </div>
                </header>
                <ToggleBar
                  title="Enable X Agent"
                  subTitle="Start automated monitoring, drafting, and optimization across your X presence."
                  checked={agentEnabled}
                  onChange={handleToggleAgentEnabled}
                />
                <div className="rounded-lg bg-white shadow-card dark:bg-light-dark">
                  <div className="relative flex items-center justify-between gap-4 p-4">
                    <div className="flex items-center ltr:mr-6 rtl:ml-6">
                      <div>
                        <span className="block text-sm font-medium uppercase tracking-wider text-gray-900 dark:text-white">
                          Language
                        </span>
                      
                      </div>
                    </div>
                    <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 p-1 text-xs dark:border-gray-700 dark:bg-[#050505]">
                      {(['en', 'zh'] as Array<'en' | 'zh'>).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => handleLanguageChange(option)}
                          className={`min-w-[3.5rem] rounded-full px-2 py-0 font-normal text-xs capitalize transition ${
                            agentLanguage === option
                              ? 'bg-white text-gray-900 shadow-sm dark:bg-white dark:text-black'
                              : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                          }`}
                        >
                          {option === 'en' ? 'En' : '中文'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="w-full flex-1 space-y-6">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-[#000000]">
            {shouldShowResultSkeleton ? (
              <div className="animate-pulse space-y-6">
                <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 dark:border-gray-800 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-5 w-52 rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="h-3 w-64 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                  <div className="flex-shrink-0">
                    <div className="h-10 w-32 rounded-full bg-gray-200 dark:bg-gray-700" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {tweetSkeletonPlaceholders.map((_, index) => (
                    <div
                      key={`tweet-skeleton-${index}`}
                      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-[#16181c]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-28 rounded bg-gray-200 dark:bg-gray-700" />
                          <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="h-3 w-full rounded bg-gray-200 dark:bg-gray-700" />
                        <div className="h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
                        <div className="h-3 w-4/6 rounded bg-gray-200 dark:bg-gray-700" />
                      </div>
                      <div className="mt-4 h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <header className="flex flex-col gap-4 border-b border-gray-200 pb-4 dark:border-gray-800 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mt-4 inline-flex rounded-full border border-gray-200 bg-gray-50 p-1 text-xs dark:border-gray-800 dark:bg-[#111318]">
                      {composerTabs.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveComposerTab(tab.key)}
                          className={cn(
                            'min-w-[5.5rem] rounded-full px-4 py-1.5 font-medium transition',
                            activeComposerTab === tab.key
                              ? 'bg-white text-gray-900 shadow-sm dark:bg-white dark:text-gray-900'
                              : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {activeComposerTab === 'result' && (
                    <div className="flex-shrink-0">
                      <MagicButton
                        onClick={handleGenerateMoreTweets}
                        disabled={isGeneratingTweets}
                        isLoading={isGeneratingTweets}
                      >
                        Generate More
                      </MagicButton>
                    </div>
                  )}
                </header>

                {activeComposerTab === 'result' ? (
                  <>
                    {generatedTweetsError && (
                      <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
                        {generatedTweetsError}
                      </div>
                    )}

                    {generatedTweets.length === 0 ? (
                      <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-gray-800 dark:bg-[#12161d]">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          No generated tweets yet—tap the button above to create a fresh strategy.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-6">
                        <Masonry
                          breakpointCols={{
                            default: 2,
                            1024: 2,
                            768: 1,
                          }}
                          className="-ml-4 flex w-auto"
                          columnClassName="pl-4 bg-clip-padding"
                        >
                          {generatedTweets.map((genTweet) => (
                            <div key={genTweet.id} className="mb-4">
                              <article
                                className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#16181c]"
                                style={{
                                  boxShadow: genTweet.isNew
                                    ? '0 0 20px rgba(240, 185, 11, 0.3), 0 0 40px rgba(240, 185, 11, 0.15)'
                                    : '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
                                  transition:
                                    'all 0.8s ease-in-out, box-shadow 0.8s ease-in-out, border-color 0.5s ease-in-out',
                                }}
                              >
                                <div className="absolute right-3 top-3 z-20 flex gap-2">
                                  <button
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                    aria-label="Edit tweet"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                      className="h-4 w-4"
                                    >
                                      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() =>
                                      handlePublishTweet(
                                        genTweet.publishText || genTweet.content,
                                      )
                                    }
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
                                    aria-label="Publish tweet"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                      className="h-4 w-4"
                                    >
                                      <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                                    </svg>
                                  </button>
                                </div>

                                <div className="p-3">
                                  <div className="flex items-start gap-3">
                                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                      <Image
                                        key={`${agentAvatarKey}-generated-${genTweet.id}`}
                                        src={agentAvatar}
                                        alt={agentDisplayName}
                                        fill
                                        sizes="40px"
                                        className="object-cover"
                                        unoptimized={isAgentAvatarRemote}
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-gray-900 dark:text-white">
                                        {agentDisplayName}
                                      </p>
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                        {agentHandle}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex-1 px-3 pb-3">
                                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800 dark:text-gray-200">
                                    {genTweet.content}
                                  </p>
                                  {genTweet.tags.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {genTweet.tags.slice(0, 3).map((tag) => (
                                        <span
                                          key={`${genTweet.id}-${tag}`}
                                          className="text-xs font-medium text-gray-700 hover:underline dark:text-gray-300"
                                        >
                                          #{tag}
                                        </span>
                                      ))}
                                      {genTweet.tags.length > 3 && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          +{genTweet.tags.length - 3}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {genTweet.notes && (
                                  <div className="mx-3 mb-2 rounded-lg border border-gray-300 bg-gray-100 px-2 py-1.5 text-[10px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                    <span className="font-semibold">⚠️ </span>
                                    {genTweet.notes}
                                  </div>
                                )}

                                <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-800">
                                  <h4 className="text-sm text-gray-900 dark:text-white">
                                    {genTweet.title}
                                  </h4>
                                </div>
                              </article>
                            </div>
                          ))}
                        </Masonry>
                      </div>
                    )}
                  </>
                ) : (
                  <ComposeChatPanel />
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
