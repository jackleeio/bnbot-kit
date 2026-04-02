'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRightIcon, PencilSquareIcon, ChatBubbleOvalLeftIcon } from '@heroicons/react/24/outline';
import XAgentChatPanel, { XAgentChatPanelRef } from '@/components/x-agent/x-agent-chat-panel';
import XAgentPanel from '@/components/x-agent/x-agent-panel';
import { useTelegramBinding } from '@/hooks/useTelegramBinding';
import { useNotification } from '@/context/notification-context';
import { TweetDraft } from '@/types/x-agent';
import LoginModal from '@/components/login/login-modal';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/hooks/useAuth';

export default function XAgentPage() {
  const [currentTweet, setCurrentTweet] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<TweetDraft | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [panelView, setPanelView] = useState<'viral-tweet' | 'advanced-search' | 'task'>('viral-tweet');

  // Agent settings state
  const [xAgentData, setXAgentData] = useState<Record<string, any> | null>(null);
  const [isFetchingAgent, setIsFetchingAgent] = useState(true);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [agentLanguage, setAgentLanguage] = useState<'en' | 'zh'>('en');
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [boundAgentId, setBoundAgentId] = useState<string | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [didSettingsChange, setDidSettingsChange] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);

  const settingsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const componentIsMountedRef = useRef(true);
  const chatPanelRef = useRef<XAgentChatPanelRef>(null);
  const [hasMessages, setHasMessages] = useState(false);
  const prevIsMobileRef = useRef(false);

  const { showNotification } = useNotification();
  const { isLoggedIn } = useAuth();

  // Telegram binding hook
  const {
    requestBindingCode,
    isLoading: isTelegramLoading,
    error: telegramError,
  } = useTelegramBinding({
    agentId: boundAgentId,
    onSuccess: () => {
      setTelegramConnected(true);
      showNotification({
        title: 'Success',
        msg: 'Telegram connected successfully!',
        type: 'success',
        icon: <span>✓</span>,
      });
    },
    onError: (error) => {
      showNotification({
        title: 'Error',
        msg: error.message || 'Failed to connect Telegram',
        type: 'error',
        icon: <span>✕</span>,
      });
    },
  });

  // Initialize component and load cached xAgentData
  useEffect(() => {
    const initialIsMobile = window.innerWidth < 768;
    setIsMobile(initialIsMobile);
    prevIsMobileRef.current = initialIsMobile;
    setHasMounted(true);

    // Load xAgentData from localStorage on mount
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('xAgentData.bnbot');
        if (stored) {
          const parsedData = JSON.parse(stored);
          console.log('🚀 Initial load of xAgentData from localStorage:', parsedData);
          setXAgentData(parsedData);
        }
      } catch (error) {
        console.error('Failed to load initial xAgentData from localStorage:', error);
      }
    }

    const checkIfMobile = () => {
      const newIsMobile = window.innerWidth < 768;
      // When switching from mobile to desktop, show preview panel
      if (prevIsMobileRef.current && !newIsMobile) {
        setShowPreview(true);
      }
      prevIsMobileRef.current = newIsMobile;
      setIsMobile(newIsMobile);
    };

    window.addEventListener('resize', checkIfMobile);

    return () => {
      window.removeEventListener('resize', checkIfMobile);
    };
  }, []);

  // Fetch X Agent data from API
  const fetchAgentData = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    // Only fetch if logged in
    if (!isLoggedIn) {
      if (componentIsMountedRef.current) {
        setIsFetchingAgent(false);
      }
      return;
    }

    setIsFetchingAgent(true);
    try {
      const data = await apiClient.get('/api/v1/agents/x-agent');
      console.log('📥 Fetched X Agent data from API:', data);
      if (componentIsMountedRef.current) {
        console.log('✅ Setting xAgentData state');
        setXAgentData(data);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('xAgentData.bnbot', JSON.stringify(data));
            console.log('💾 Saved to localStorage');
          } catch (storageError) {
            console.error(
              'Failed to persist X Agent data in localStorage:',
              storageError,
            );
          }
        }
      }
    } catch (error) {
      console.error('Error fetching X Agent:', error);
    } finally {
      if (componentIsMountedRef.current) {
        setIsFetchingAgent(false);
      }
    }
  }, [isLoggedIn]);

  // Fetch agent data on mount
  useEffect(() => {
    fetchAgentData();
  }, [fetchAgentData]);

  // Sync state from xAgentData
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

    console.log('🔄 Syncing xAgentData:', xAgentData);

    // Sync agent enabled state
    if (typeof xAgentData.is_active === 'boolean') {
      console.log('✅ Setting agentEnabled:', xAgentData.is_active);
      setAgentEnabled(xAgentData.is_active);
    } else {
      console.log('⚠️ is_active not found, defaulting to true');
      setAgentEnabled(true);
    }

    // Sync language
    if (typeof xAgentData.language === 'string') {
      const normalized = xAgentData.language.trim().toLowerCase();
      const lang = normalized === 'zh' ? 'zh' : 'en';
      console.log('✅ Setting language:', lang, '(from:', xAgentData.language, ')');
      setAgentLanguage(lang);
    } else {
      console.log('⚠️ language not found, defaulting to en');
      setAgentLanguage('en');
    }

    // Sync telegram connection status - check multiple possible field names
    const hasTelegramBinding =
      xAgentData.telegram_chat_id ||
      xAgentData.telegram_user_id ||
      xAgentData.telegram_username ||
      xAgentData.telegram_binding ||
      (xAgentData.integrations && xAgentData.integrations.telegram);

    console.log('📱 Telegram connection status:', {
      telegram_chat_id: xAgentData.telegram_chat_id,
      telegram_user_id: xAgentData.telegram_user_id,
      telegram_username: xAgentData.telegram_username,
      telegram_binding: xAgentData.telegram_binding,
      integrations: xAgentData.integrations,
      connected: !!hasTelegramBinding
    });
    setTelegramConnected(!!hasTelegramBinding);

    // Extract agent ID
    const agentId = xAgentData.id || xAgentData.agent_id || xAgentData.x_agent_id;
    if (agentId) {
      console.log('🆔 Agent ID:', agentId);
      setBoundAgentId(String(agentId));
      if (typeof window !== 'undefined') {
        localStorage.setItem('bound_agent_id', String(agentId));
      }
    } else {
      console.warn('⚠️ No agent ID found in xAgentData');
    }
  }, [xAgentData]);

  // Load user data on mount
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
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      componentIsMountedRef.current = false;
      if (settingsSaveTimeoutRef.current) {
        clearTimeout(settingsSaveTimeoutRef.current);
        settingsSaveTimeoutRef.current = null;
      }
    };
  }, []);

  // Handle tweet generated from chat
  const handleTweetGenerated = (tweetText: string) => {
    setCurrentTweet(tweetText);
    setSelectedDraft(null);
    setGeneratedImageUrl(null);
    setShowPreview(true);
  };

  // Handle draft preview - automatically open preview panel
  const handleDraftPreview = useCallback((draft: TweetDraft) => {
    setSelectedDraft(draft);
    setCurrentTweet(null);
    setGeneratedImageUrl(null);
    setShowPreview(true);
  }, []);

  // Handle image generated from chat
  const handleImageGenerated = useCallback((imageUrl: string) => {
    console.log('Image generated:', imageUrl);
    setGeneratedImageUrl(imageUrl);
    setIsGeneratingImage(false);
  }, []);

  // Handle tweet edit
  const handleTweetEdit = (newText: string) => {
    setCurrentTweet(newText);
  };

  // Handle tweet save
  const handleTweetSave = (text: string) => {
    console.log('Tweet saved:', text);
    // TODO: Save to backend/local storage
  };

  // Handle tweet publish
  const handleTweetPublish = (text: string) => {
    console.log('Publishing tweet:', text);
    // TODO: Call Twitter API to publish
  };

  // Persist agent settings to API with debounce
  const persistAgentSettings = useCallback(async () => {
    // Get latest xAgentData from localStorage if state is stale
    let currentXAgentData = xAgentData;
    if (!currentXAgentData && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('xAgentData.bnbot');
        if (stored) {
          currentXAgentData = JSON.parse(stored);
          console.log('📦 Loaded xAgentData from localStorage for persist:', currentXAgentData);
        }
      } catch (error) {
        console.error('Failed to load xAgentData from localStorage:', error);
      }
    }

    if (!currentXAgentData) {
      console.error('⚠️ Cannot persist - no xAgentData available');
      return;
    }

    settingsSaveTimeoutRef.current = null;

    // Check if logged in using isLoggedIn from useAuth
    if (!isLoggedIn) {
      setSettingsError('Login expired, please log in again.');
      setDidSettingsChange(false);
      setSettingsSaved(false);
      return;
    }

    // Extract agent ID
    const agentId = currentXAgentData.id || currentXAgentData.agent_id || currentXAgentData.x_agent_id;
    if (!agentId) {
      setSettingsError('Agent ID not found');
      setDidSettingsChange(false);
      return;
    }

    const payload: Record<string, any> = {
      is_active: agentEnabled,
      language: agentLanguage,
    };

    console.log('💾 Persisting settings:', payload, 'for agent:', agentId);
    setIsSavingSettings(true);
    setSettingsError(null);

    try {
      console.log('🔐 Making PATCH request to:', `/api/v1/agents/${agentId}/settings`);
      console.log('📤 Payload:', payload);

      await apiClient.put(`/api/v1/agents/${agentId}/settings`, payload);
      console.log('✅ Settings saved successfully');

      setDidSettingsChange(false);
      setSettingsSaved(true);

      // Re-fetch agent data to sync
      await fetchAgentData();

      setTimeout(() => {
        setSettingsSaved(false);
      }, 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSettingsError('Failed to save settings');
      setSettingsSaved(false);
    } finally {
      setIsSavingSettings(false);
    }
  }, [isLoggedIn, xAgentData, agentEnabled, agentLanguage, fetchAgentData]);

  // Auto-save settings with debounce (5 seconds)
  useEffect(() => {
    if (settingsSaveTimeoutRef.current) {
      clearTimeout(settingsSaveTimeoutRef.current);
      settingsSaveTimeoutRef.current = null;
    }

    if (!didSettingsChange || !xAgentData) {
      return;
    }

    console.log('⏱️ Settings changed, will save in 5 seconds...');
    settingsSaveTimeoutRef.current = setTimeout(() => {
      void persistAgentSettings();
    }, 5000); // Save after 5 seconds of inactivity

    return () => {
      if (settingsSaveTimeoutRef.current) {
        clearTimeout(settingsSaveTimeoutRef.current);
        settingsSaveTimeoutRef.current = null;
      }
    };
  }, [agentEnabled, agentLanguage, xAgentData, didSettingsChange, persistAgentSettings]);

  // Agent settings handlers - only update state, debounced save happens in useEffect
  const handleToggleAgentEnabled = useCallback(
    (value: boolean) => {
      console.log('🎯 handleToggleAgentEnabled called with value:', value);
      console.log('   Current agentEnabled:', agentEnabled);
      console.log('   xAgentData exists?', !!xAgentData);

      // If xAgentData is null, try to get it from localStorage and update state
      if (!xAgentData && typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('xAgentData.bnbot');
          if (stored) {
            const parsedData = JSON.parse(stored);
            console.log('📦 Loading xAgentData from localStorage to enable interaction');
            setXAgentData(parsedData);
            // Don't return - continue with the update
          } else {
            console.error('⚠️ No xAgentData in localStorage either');
            return;
          }
        } catch (error) {
          console.error('Failed to load xAgentData from localStorage:', error);
          return;
        }
      }

      if (value === agentEnabled) {
        console.log('⚠️ Early return - same value:', value);
        return;
      }

      console.log('✅ Setting agentEnabled to:', value, 'and marking settings as changed');
      setSettingsError(null);
      setAgentEnabled(value);
      setDidSettingsChange(true);
      setSettingsSaved(false);
    },
    [xAgentData, agentEnabled]
  );

  const handleLanguageChange = useCallback(
    (value: 'en' | 'zh') => {
      console.log('🌐 handleLanguageChange called with value:', value);
      console.log('   Current language:', agentLanguage);
      console.log('   xAgentData exists?', !!xAgentData);

      // If xAgentData is null, try to get it from localStorage and update state
      if (!xAgentData && typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('xAgentData.bnbot');
          if (stored) {
            const parsedData = JSON.parse(stored);
            console.log('📦 Loading xAgentData from localStorage to enable interaction');
            setXAgentData(parsedData);
            // Don't return - continue with the update
          } else {
            console.error('⚠️ No xAgentData in localStorage either');
            return;
          }
        } catch (error) {
          console.error('Failed to load xAgentData from localStorage:', error);
          return;
        }
      }

      if (value === agentLanguage) {
        console.log('⚠️ Early return - same value:', value);
        return;
      }

      console.log('✅ Setting language to:', value, 'and marking settings as changed');
      setSettingsError(null);
      setAgentLanguage(value);
      setDidSettingsChange(true);
      setSettingsSaved(false);
    },
    [xAgentData, agentLanguage]
  );

  const handleTelegramConnect = useCallback(async () => {
    try {
      await requestBindingCode();
    } catch (err) {
      console.error('Telegram binding error:', err);
    }
  }, [requestBindingCode]);

  const handleGenerateImage = useCallback(async (prompt: string, tweetContent?: string) => {
    if (!prompt || !chatPanelRef.current) return;

    setIsGeneratingImage(true);
    try {
      // Send message to chat to generate image with tweet context
      const imagePrompt = agentLanguage === 'zh'
        ? `请根据以下推文内容和图片描述生成一张配图：\n\n推文内容：${tweetContent || '无'}\n\n图片描述：${prompt}`
        : `Please generate an image for the following tweet:\n\nTweet content: ${tweetContent || 'N/A'}\n\nImage description: ${prompt}`;

      await chatPanelRef.current.sendMessage(imagePrompt);
    } catch (err) {
      console.error('Image generation error:', err);
      showNotification({
        title: agentLanguage === 'zh' ? '错误' : 'Error',
        msg: err instanceof Error ? err.message : (agentLanguage === 'zh' ? '生成图片失败' : 'Failed to generate image'),
        type: 'error',
        icon: <span>✕</span>,
      });
    } finally {
      setIsGeneratingImage(false);
    }
  }, [showNotification, agentLanguage]);

  // Prevent rendering until client-side hydration
  if (!hasMounted) {
    return (
      <div className="flex h-screen overflow-hidden">
        <div className="w-full"></div>
      </div>
    );
  }

  const mobileChatTransformClass = showPreview ? '-translate-x-full' : 'translate-x-0';
  const mobilePreviewTransformClass = showPreview ? 'translate-x-0' : 'translate-x-full';

  // Debug: log xAgentData state when rendering
  console.log('🔍 Rendering page - xAgentData:', xAgentData ? 'exists' : 'NULL',
    'agentEnabled:', agentEnabled,
    'language:', agentLanguage,
    'telegram:', telegramConnected);

  return (
    <div className="flex h-screen overflow-hidden">
      <div
        className={`relative flex h-full w-full ${isMobile ? '' : 'items-center justify-center p-2'
          }`}
      >
        <div className={`flex h-full w-full ${isMobile ? '' : 'gap-2'}`}>
          {/* Chat panel stays mounted across layouts */}
          <motion.div
            className={`h-full flex justify-center ${isMobile
              ? `absolute left-0 top-0 w-full transition-transform duration-200 ease-in-out ${mobileChatTransformClass}`
              : ''
              }`}
            style={isMobile ? { zIndex: showPreview ? 0 : 10 } : undefined}
            initial={isMobile ? undefined : { width: '33.333%' }}
            animate={
              isMobile
                ? undefined
                : {
                  width: currentTweet || showPreview ? '33.333%' : '100%',
                }
            }
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <div className={`relative h-full w-full ${isMobile ? '' : 'max-w-4xl'}`}>
              <XAgentChatPanel
                ref={chatPanelRef}
                onTweetGenerated={handleTweetGenerated}
                onDraftPreview={handleDraftPreview}
                onImageGenerated={handleImageGenerated}
                agentName="X Agent"
                isMobile={isMobile}
                onShowLogin={() => setShowLoginModal(true)}
                onMessagesChange={setHasMessages}
              />

              {/* Desktop-only buttons */}
              {!isMobile && (
                <div className="absolute -right-12 top-0 flex flex-col gap-2">
                  {/* Toggle Preview Button */}
                  {!currentTweet && !showPreview && (
                    <button
                      onClick={() => setShowPreview(true)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      title="Show Preview"
                    >
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  )}
                  {/* New Chat Button - only show when preview is hidden */}
                  {hasMessages && !currentTweet && !showPreview && (
                    <button
                      onClick={() => chatPanelRef.current?.handleNewChat()}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      title="Start new chat"
                    >
                      <ChatBubbleOvalLeftIcon className="h-5 w-5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>

          {/* Preview panel */}
          {isMobile ? (
            <div
              className={`absolute left-0 top-0 h-full w-full transition-transform duration-200 ease-in-out ${mobilePreviewTransformClass}`}
              style={{ zIndex: showPreview ? 10 : 0 }}
            >
              <XAgentPanel
                tweetText={currentTweet}
                selectedDraft={selectedDraft}
                onEdit={handleTweetEdit}
                onSave={handleTweetSave}
                onPublish={handleTweetPublish}
                onClose={() => {
                  setShowPreview(false);
                  setCurrentTweet(null);
                  setSelectedDraft(null);
                  setGeneratedImageUrl(null);
                }}
                isMobile={isMobile}
                agentEnabled={agentEnabled}
                agentLanguage={agentLanguage}
                telegramConnected={telegramConnected}
                isTelegramLoading={isTelegramLoading}
                isFetchingSettings={isFetchingAgent}
                onToggleAgent={handleToggleAgentEnabled}
                onLanguageChange={handleLanguageChange}
                onTelegramConnect={handleTelegramConnect}
                isLoggedIn={!!userData}
                onLogin={() => setShowLoginModal(true)}
                onGenerateImage={handleGenerateImage}
                isGeneratingImage={isGeneratingImage}
                generatedImageUrl={generatedImageUrl}
                currentView={panelView}
                onViewChange={setPanelView}
                onNewChat={() => chatPanelRef.current?.handleNewChat()}
                hasMessages={hasMessages}
              />
            </div>
          ) : (
            <AnimatePresence>
              {(currentTweet || selectedDraft || showPreview) && (
                <motion.div
                  className="h-full w-2/3"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <XAgentPanel
                    tweetText={currentTweet}
                    selectedDraft={selectedDraft}
                    onEdit={handleTweetEdit}
                    onSave={handleTweetSave}
                    onPublish={handleTweetPublish}
                    onClose={() => {
                      setShowPreview(false);
                      setCurrentTweet(null);
                      setSelectedDraft(null);
                      setGeneratedImageUrl(null);
                    }}
                    isMobile={false}
                    agentEnabled={agentEnabled}
                    agentLanguage={agentLanguage}
                    telegramConnected={telegramConnected}
                    isTelegramLoading={isTelegramLoading}
                    isFetchingSettings={isFetchingAgent}
                    onToggleAgent={handleToggleAgentEnabled}
                    onLanguageChange={handleLanguageChange}
                    onTelegramConnect={handleTelegramConnect}
                    isLoggedIn={!!userData}
                    onLogin={() => setShowLoginModal(true)}
                    onGenerateImage={handleGenerateImage}
                    isGeneratingImage={isGeneratingImage}
                    generatedImageUrl={generatedImageUrl}
                    currentView={panelView}
                    onViewChange={setPanelView}
                    onNewChat={() => chatPanelRef.current?.handleNewChat()}
                    hasMessages={hasMessages}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Floating toggle button for mobile */}
        {isMobile && (
          <motion.button
            className="fixed bottom-40 right-0 z-20 w-[36px] rounded-l-xl bg-gray-100/80 py-1.5 pl-1 pr-1 text-gray-500 shadow-sm transition-all duration-200 hover:bg-gray-200/60"
            onClick={() => setShowPreview(!showPreview)}
            aria-label={showPreview ? 'Close preview' : 'Open preview'}
            whileTap={{ scale: 0.95 }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={showPreview ? 'close' : 'open'}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex h-6 w-6 items-center justify-center"
              >
                {showPreview ? (
                  <ChevronRightIcon className="h-4 w-4 text-gray-600" />
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </div>
  );
}
