'use client';

import {
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ChangeEvent,
} from 'react';
import { type StaticImageData } from 'next/image';
import { Dialog, Transition } from '@headlessui/react';
import Button from '@/components/ui/button';

type CharacterMessageContent =
  | string
  | {
      text?: string;
    }
  | null
  | undefined;

type CharacterMessage = {
  user?: string;
  content?: CharacterMessageContent;
};

type CharacterMessageThread = CharacterMessage[];

type CharacterStyle = Record<string, string[] | undefined>;

const getMessageText = (content: CharacterMessageContent): string => {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (typeof content.text === 'string') {
    return content.text;
  }
  return '';
};

export interface CharacterPayload {
  name?: string;
  system?: string;
  bio?: string[];
  lore?: string[];
  knowledge?: string[];
  topics?: string[];
  people?: string[];
  adjectives?: string[];
  postExamples?: string[];
  messageExamples?: CharacterMessageThread[];
  style?: CharacterStyle;
}

export interface UpdateAgentPayload {
  username?: string;
  name?: string;
  twitter_id?: string;
  auth_token?: string;
  topic?: string;
  tags?: string;
  character?: CharacterPayload;
  wallet_address?: string;
  target_username?: string;
  target_twitter_id?: string;
  avatar?: string;
  description?: string;
  is_active?: boolean;
  daily_tweet_generation?: boolean;
  telegram_push_notifications?: boolean;
  telegram_user_id?: string;
  telegram_username?: string;
  telegram_chat_id?: string;
  language?: string;
}

export interface CharacterDetailsModalProps {
  open: boolean;
  onClose: () => void;
  agentName: string;
  agentHandle: string;
  avatar: string | StaticImageData;
  isAvatarRemote?: boolean;
  banner?: string | null;
  character?: CharacterPayload | null;
  agentData?: Record<string, any> | null;
  onSubmit: (payload: UpdateAgentPayload) => Promise<void>;
  isSubmitting?: boolean;
}

interface CharacterFormState {
  name: string;
  username: string;
  avatar: string;
  description: string;
  tags: string;
  target_username: string;
  target_twitter_id: string;
  is_active: boolean;
  characterName: string;
  system: string;
  bio: string;
  lore: string;
  knowledge: string;
  topics: string;
  people: string;
  adjectives: string;
  postExamplesJsonText: string;
  styleText: string;
}

const toStringList = (value?: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (typeof item === 'number') {
        return String(item);
      }
      return '';
    })
    .filter(Boolean);
};

const joinLines = (list?: string[]): string =>
  Array.isArray(list) && list.length > 0 ? list.join('\n') : '';

const formatPostExamplesText = (examples?: string[] | null): string => {
  if (!Array.isArray(examples) || examples.length === 0) {
    return '[]';
  }
  try {
    return JSON.stringify(examples, null, 2);
  } catch {
    return '[]';
  }
};

const formatStyleText = (style?: CharacterStyle | null): string => {
  if (!style) {
    return '';
  }
  try {
    return JSON.stringify(style, null, 2);
  } catch {
    return '';
  }
};


const buildInitialState = (
  agentData: Record<string, any> | null | undefined,
  character: CharacterPayload | null | undefined,
  fallbackName: string,
): CharacterFormState => {
  return {
    name: typeof agentData?.name === 'string' ? agentData.name : '',
    username:
      typeof agentData?.username === 'string' ? agentData.username : '',
    avatar: typeof agentData?.avatar === 'string' ? agentData.avatar : '',
    description:
      typeof agentData?.description === 'string' ? agentData.description : '',
    tags: typeof agentData?.tags === 'string' ? agentData.tags : '',
    target_username:
      typeof agentData?.target_username === 'string'
        ? agentData.target_username
        : '',
    target_twitter_id:
      typeof agentData?.target_twitter_id === 'string'
        ? agentData.target_twitter_id
        : '',
    is_active:
      typeof agentData?.is_active === 'boolean' ? agentData.is_active : true,
    characterName:
      typeof character?.name === 'string' && character.name.trim().length > 0
        ? character.name
        : fallbackName,
    system:
      typeof character?.system === 'string' ? character.system.trim() : '',
    bio: joinLines(character?.bio),
    lore: joinLines(character?.lore),
    knowledge: joinLines(character?.knowledge),
    topics: joinLines(character?.topics),
    people: joinLines(character?.people),
    adjectives: joinLines(character?.adjectives),
    postExamplesJsonText: formatPostExamplesText(character?.postExamples),
    styleText: formatStyleText(character?.style),
  };
};

const parseLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const isCharacterPayloadPopulated = (payload: CharacterPayload): boolean =>
  Object.values(payload).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === 'object' && value !== null) {
      return Object.keys(value).length > 0;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return Boolean(value);
  });

function CharacterSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-gray-500 dark:text-gray-400">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-3 rounded-2xl border border-gray-100 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
        {children}
      </div>
    </section>
  );
}

export default function CharacterDetailsModal({
  open,
  onClose,
  agentName,
  agentHandle,
  avatar: _avatar,
  isAvatarRemote: _isAvatarRemote,
  banner: _banner,
  character,
  agentData,
  onSubmit,
  isSubmitting,
}: CharacterDetailsModalProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const initialState = useMemo(
    () => buildInitialState(agentData, character, agentName),
    [agentData, character, agentName],
  );
  const [formState, setFormState] = useState<CharacterFormState>(initialState);

  useEffect(() => {
    if (open) {
      setFormState(initialState);
      setFormError(null);
    }
  }, [initialState, open]);

  const handleInputChange =
    (field: keyof CharacterFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { value } = event.target;
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    };

  const handleCheckboxChange = (field: keyof CharacterFormState) => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const { checked } = event.target;
      setFormState((prev) => ({
        ...prev,
        [field]: checked,
      }));
    };
  };
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const nextCharacter: CharacterPayload = {};
    const trimmedCharacterName = formState.characterName.trim();
    const trimmedSystem = formState.system.trim();
    const bioList = parseLines(formState.bio);
    const loreList = parseLines(formState.lore);
    const knowledgeList = parseLines(formState.knowledge);
    const topicsList = parseLines(formState.topics);
    const peopleList = parseLines(formState.people);
    const adjectivesList = parseLines(formState.adjectives);
    let parsedPostExamples: string[] | undefined;
    const trimmedPostExamplesText = formState.postExamplesJsonText.trim();
    let parsedStyle: CharacterStyle | undefined;
    const trimmedStyleText = formState.styleText.trim();
    if (trimmedStyleText) {
      try {
        const parsed = JSON.parse(trimmedStyleText);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error();
        }
        parsedStyle = parsed as CharacterStyle;
      } catch {
        setFormError('Style JSON 无法解析，请检查格式。');
        return;
      }
    }
    if (trimmedPostExamplesText) {
      try {
        const parsed = JSON.parse(trimmedPostExamplesText);
        if (!Array.isArray(parsed)) {
          throw new Error();
        }
        parsedPostExamples = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item): item is string => Boolean(item));
      } catch {
        setFormError('Post Examples JSON 无法解析，请检查格式。');
        return;
      }
    }

    if (trimmedCharacterName) {
      nextCharacter.name = trimmedCharacterName;
    }
    if (trimmedSystem) {
      nextCharacter.system = trimmedSystem;
    }
    if (bioList.length) {
      nextCharacter.bio = bioList;
    }
    if (loreList.length) {
      nextCharacter.lore = loreList;
    }
    if (knowledgeList.length) {
      nextCharacter.knowledge = knowledgeList;
    }
    if (topicsList.length) {
      nextCharacter.topics = topicsList;
    }
    if (peopleList.length) {
      nextCharacter.people = peopleList;
    }
    if (adjectivesList.length) {
      nextCharacter.adjectives = adjectivesList;
    }
    if (parsedPostExamples && parsedPostExamples.length > 0) {
      nextCharacter.postExamples = parsedPostExamples;
    }
    if (
      Array.isArray(character?.messageExamples) &&
      character.messageExamples.length > 0
    ) {
      nextCharacter.messageExamples = character.messageExamples;
    }
    if (parsedStyle && Object.keys(parsedStyle).length > 0) {
      nextCharacter.style = parsedStyle;
    }

    const payload: UpdateAgentPayload = {};
    const trimmedName = formState.name.trim();
    const trimmedUsername = formState.username.trim().replace(/^@/, '');
    const trimmedAvatar = formState.avatar.trim();
    const trimmedDescription = formState.description.trim();
    const trimmedTags = formState.tags.trim();
    const trimmedTargetUsername = formState.target_username
      .trim()
      .replace(/^@/, '');
    const trimmedTargetTwitterId = formState.target_twitter_id.trim();

    if (trimmedName) {
      payload.name = trimmedName;
    }
    if (trimmedUsername) {
      payload.username = trimmedUsername;
    }
    if (trimmedAvatar) {
      payload.avatar = trimmedAvatar;
    }
    if (trimmedDescription) {
      payload.description = trimmedDescription;
    }
    if (trimmedTags) {
      payload.tags = trimmedTags;
    }
    if (trimmedTargetUsername) {
      payload.target_username = trimmedTargetUsername;
    }
    if (trimmedTargetTwitterId) {
      payload.target_twitter_id = trimmedTargetTwitterId;
    }
    payload.is_active = formState.is_active;

    if (isCharacterPayloadPopulated(nextCharacter)) {
      payload.character = nextCharacter;
    }

    try {
      await onSubmit(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '更新失败，请稍后重试。';
      setFormError(message);
    }
  };

  return (
    <>
      <Transition appear show={open} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white text-left shadow-2xl dark:bg-[#050505]">
                <div className="character-modal-scroll max-h-[90vh] overflow-y-auto">
                  <div className="px-6 pb-8 pt-8 sm:px-10">
                    <form className="space-y-8" onSubmit={handleSubmit}>

                      <CharacterSection
                        title=""
                        description=""
                      >
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
                              System Prompt
                            </p>
                            <textarea
                              value={formState.system}
                              onChange={handleInputChange('system')}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                              rows={4}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
                              Bio
                            </p>
                            <textarea
                              value={formState.bio}
                              onChange={handleInputChange('bio')}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                              rows={4}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
                              Lore
                            </p>
                            <textarea
                              value={formState.lore}
                              onChange={handleInputChange('lore')}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                              rows={4}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
                              Knowledge
                            </p>
                            <textarea
                              value={formState.knowledge}
                              onChange={handleInputChange('knowledge')}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                              rows={3}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
                              Topics
                            </p>
                            <textarea
                              value={formState.topics}
                              onChange={handleInputChange('topics')}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                              rows={3}
                            />
                          </div>

                          <div className="space-y-2">
                            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
                              Adjectives
                            </p>
                            <textarea
                              value={formState.adjectives}
                              onChange={handleInputChange('adjectives')}
                              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                              rows={3}
                            />
                          </div>
                        </div>
                      </CharacterSection>

                      <CharacterSection
                        title="Post Examples"
                        description="使用 JSON 列出代表性发帖示例，保存后将直接推送给模型。"
                      >
                        <textarea
                          value={formState.postExamplesJsonText}
                          onChange={handleInputChange('postExamplesJsonText')}
                          className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-xs leading-6 text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                          rows={6}
                          spellCheck={false}
                          wrap="off"
                          placeholder='例如：[\n  "示例推文内容"\n]'
                        />
                      </CharacterSection>

                      <CharacterSection
                        title="Style"
                        description={'使用 JSON 描述不同场景下的风格，例如 { "all": ["rule"] }。'}
                      >
                        <textarea
                          value={formState.styleText}
                          onChange={(event) =>
                            setFormState((prev) => ({
                              ...prev,
                              styleText: event.target.value,
                            }))
                          }
                          spellCheck={false}
                          rows={6}
                          wrap="off"
                          placeholder='例如：{ "all": ["Short and punchy responses"] }'
                          className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-xs leading-6 text-gray-900 focus:border-black focus:bg-white focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-gray-100"
                        />
                      </CharacterSection>

                      {formError ? (
                        <p className="text-sm text-red-500">{formError}</p>
                      ) : null}

                    </form>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
      </Transition>
      <style jsx global>{`
        .character-modal-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .character-modal-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </>
  );
}
