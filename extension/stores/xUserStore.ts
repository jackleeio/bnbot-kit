/**
 * 全局 X 用户信息存储
 * 从 Twitter 页面 DOM 获取当前登录用户的信息并缓存
 */

export interface XUserInfo {
  username: string | null;      // 用户名 (如 jackleeio)
  displayName: string | null;   // 显示名 (如 Jack Lee)
  avatarUrl: string | null;     // 头像 URL
  userId: string | null;        // 用户 ID (数字字符串)
  isBlueVerified: boolean;      // 是否蓝V认证（从 __INITIAL_STATE__ 获取）
  // 以下字段从 __INITIAL_STATE__ 获取
  followersCount: number | null;   // 粉丝数
  friendsCount: number | null;     // 关注数
  statusesCount: number | null;    // 推文数
  favouritesCount: number | null;  // 喜欢数
  description: string | null;      // 个人简介
  createdAt: string | null;        // 账号创建时间
}

type Listener = (userInfo: XUserInfo) => void;

class XUserStore {
  private userInfo: XUserInfo = {
    username: null,
    displayName: null,
    avatarUrl: null,
    userId: null,
    isBlueVerified: false,
    followersCount: null,
    friendsCount: null,
    statusesCount: null,
    favouritesCount: null,
    description: null,
    createdAt: null,
  };
  private listeners: Set<Listener> = new Set();
  private initialized = false;

  /**
   * 从头像 URL 提取用户 ID
   * URL 格式: https://pbs.twimg.com/profile_images/{userId}/xxx.jpg
   */
  private extractUserIdFromAvatarUrl(url: string | null): string | null {
    if (!url) return null;
    const match = url.match(/profile_images\/(\d+)\//);
    return match ? match[1] : null;
  }

  /**
   * 从页面的 script 标签解析 __INITIAL_STATE__
   * Content script 无法直接访问页面 window 对象，需要从 DOM 中解析
   */
  private parseInitialStateFromDOM(): any | null {
    try {
      const scripts = document.querySelectorAll('script[type="text/javascript"]');
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('window.__INITIAL_STATE__=')) {
          // 提取 JSON 部分：window.__INITIAL_STATE__={...};
          const startIndex = content.indexOf('window.__INITIAL_STATE__=') + 'window.__INITIAL_STATE__='.length;
          let endIndex = content.indexOf('};', startIndex) + 1;
          if (endIndex <= startIndex) {
            // 尝试找到分号结尾
            endIndex = content.indexOf(';', startIndex);
          }
          if (endIndex > startIndex) {
            const jsonStr = content.substring(startIndex, endIndex);
            return JSON.parse(jsonStr);
          }
        }
      }
      return null;
    } catch (error) {
      console.error('[XUserStore] Error parsing __INITIAL_STATE__ from DOM:', error);
      return null;
    }
  }

  /**
   * 从页面的 window.__INITIAL_STATE__ 获取用户详细信息
   * 包含 followers_count, friends_count 等 DOM 中无法获取的数据
   * 注意：优先使用 session.user_id，因为头像 URL 中的 ID 是图片 ID 不是用户 ID
   */
  private getInitialStateUserInfo(): Partial<XUserInfo> {
    try {
      // Content script 无法直接访问页面的 window 对象，需要从 script 标签解析
      const initialState = this.parseInitialStateFromDOM();
      if (!initialState) {
        console.debug('[XUserStore] __INITIAL_STATE__ not found in DOM');
        return {};
      }

      // 从 session 获取当前登录用户的 ID（这是真正的用户 ID）
      const targetUserId = initialState.session?.user_id;
      if (!targetUserId) {
        console.debug('[XUserStore] session.user_id not found');
        return {};
      }

      // 从 entities.users.entities 中获取用户详细信息
      const userEntity = initialState.entities?.users?.entities?.[targetUserId];
      if (!userEntity) {
        console.debug('[XUserStore] User entity not found for user_id:', targetUserId);
        return {};
      }

      return {
        userId: userEntity.id_str || targetUserId,
        displayName: userEntity.name || null,
        username: userEntity.screen_name?.toLowerCase() || null,
        avatarUrl: userEntity.profile_image_url_https || null,
        followersCount: userEntity.followers_count ?? null,
        friendsCount: userEntity.friends_count ?? null,
        statusesCount: userEntity.statuses_count ?? null,
        favouritesCount: userEntity.favourites_count ?? null,
        description: userEntity.description || null,
        isBlueVerified: userEntity.is_blue_verified ?? false,
        createdAt: userEntity.created_at || null,
      };
    } catch (error) {
      console.error('[XUserStore] Error parsing __INITIAL_STATE__:', error);
      return {};
    }
  }

  /**
   * 从 Twitter 页面 DOM 获取当前登录用户的信息
   */
  private detectUserInfo(): XUserInfo {
    let username: string | null = null;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    let userId: string | null = null;
    let verified: boolean = false;

    // 方法1: 通过 AppTabBar_Profile_Link 获取用户名 (最可靠)
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href && href.startsWith('/')) {
        const uname = href.slice(1).toLowerCase();
        if (uname && !uname.includes('/')) {
          username = uname;
        }
      }
    }

    // 方法2: 通过 SideNav_AccountSwitcher_Button 获取更多信息
    const accountSwitcherBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountSwitcherBtn) {
      // 获取用户名 (备用)
      if (!username) {
        const text = accountSwitcherBtn.textContent || '';
        const match = text.match(/@(\w+)/);
        if (match) {
          username = match[1].toLowerCase();
        }
      }

      // 获取头像 URL、userId 和 displayName (从 img alt 属性)
      const avatarImg = accountSwitcherBtn.querySelector('img[src*="profile_images"]');
      if (avatarImg) {
        avatarUrl = avatarImg.getAttribute('src');
        userId = this.extractUserIdFromAvatarUrl(avatarUrl);
        // 从 alt 属性获取显示名
        const altText = avatarImg.getAttribute('alt');
        if (altText && altText.trim()) {
          displayName = altText.trim();
        }
      }

      // 检测认证状态 (通过 icon-verified 图标)
      const verifiedIcon = accountSwitcherBtn.querySelector('[data-testid="icon-verified"]') ||
        accountSwitcherBtn.querySelector('svg[aria-label="认证账号"]') ||
        accountSwitcherBtn.querySelector('svg[aria-label="Verified account"]');
      verified = !!verifiedIcon;
    }

    // 方法3: 通过 UserAvatar-Container 获取用户名 (备用)
    if (!username) {
      const avatarContainer = document.querySelector('[data-testid^="UserAvatar-Container-"]');
      if (avatarContainer) {
        const testId = avatarContainer.getAttribute('data-testid');
        if (testId) {
          const match = testId.match(/UserAvatar-Container-(.+)/);
          if (match && match[1]) {
            username = match[1].toLowerCase();
          }
        }
      }
    }

    // 方法4: 如果还没有头像，尝试从 AppTabBar_Profile_Link 内的 img 获取
    if (!avatarUrl && profileLink) {
      const avatarImg = profileLink.querySelector('img[src*="profile_images"]');
      if (avatarImg) {
        avatarUrl = avatarImg.getAttribute('src');
        if (!userId) {
          userId = this.extractUserIdFromAvatarUrl(avatarUrl);
        }
        // 从 alt 属性获取显示名
        if (!displayName) {
          const altText = avatarImg.getAttribute('alt');
          if (altText && altText.trim()) {
            displayName = altText.trim();
          }
        }
      }
    }

    // 方法5: 从 __INITIAL_STATE__ 获取更多用户信息（followers, friends 等）
    // 注意：这里不传入 userId，因为从头像 URL 提取的是图片 ID，不是用户 ID
    // __INITIAL_STATE__ 会使用 session.user_id 获取正确的用户 ID
    const initialStateInfo = this.getInitialStateUserInfo();

    // 合并数据：__INITIAL_STATE__ 的 userId 更可靠，其他字段 DOM 优先
    return {
      username: username || initialStateInfo.username || null,
      displayName: displayName || initialStateInfo.displayName || null,
      avatarUrl: avatarUrl || initialStateInfo.avatarUrl || null,
      userId: initialStateInfo.userId || null,  // 优先使用 __INITIAL_STATE__ 的用户 ID
      followersCount: initialStateInfo.followersCount ?? null,
      friendsCount: initialStateInfo.friendsCount ?? null,
      statusesCount: initialStateInfo.statusesCount ?? null,
      favouritesCount: initialStateInfo.favouritesCount ?? null,
      description: initialStateInfo.description ?? null,
      isBlueVerified: initialStateInfo.isBlueVerified ?? false,
      createdAt: initialStateInfo.createdAt ?? null,
    };
  }

  /**
   * 初始化并开始监听用户信息变化
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // 立即尝试获取
    this.update();

    // 定期检查（处理页面加载延迟和用户切换）
    setInterval(() => this.update(), 2000);

    // 监听 DOM 变化，当左侧导航加载完成时更新
    this.observeNavigation();
  }

  /**
   * 监听左侧导航栏加载，确保能获取到头像
   */
  private observeNavigation(): void {
    const observer = new MutationObserver(() => {
      // 检查是否有头像元素出现
      if (!this.userInfo.avatarUrl) {
        const avatarImg = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img[src*="profile_images"]') ||
                          document.querySelector('a[data-testid="AppTabBar_Profile_Link"] img[src*="profile_images"]');
        if (avatarImg) {
          this.update();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 5秒后停止观察，避免性能问题
    setTimeout(() => observer.disconnect(), 5000);
  }

  /**
   * 更新用户信息
   */
  update(): void {
    const newUserInfo = this.detectUserInfo();

    // 合并逻辑：保留已有值，不用 null 覆盖
    const mergedInfo: XUserInfo = {
      username: newUserInfo.username || this.userInfo.username,
      displayName: newUserInfo.displayName || this.userInfo.displayName,
      avatarUrl: newUserInfo.avatarUrl || this.userInfo.avatarUrl,
      userId: newUserInfo.userId || this.userInfo.userId,
      followersCount: newUserInfo.followersCount ?? this.userInfo.followersCount,
      friendsCount: newUserInfo.friendsCount ?? this.userInfo.friendsCount,
      statusesCount: newUserInfo.statusesCount ?? this.userInfo.statusesCount,
      favouritesCount: newUserInfo.favouritesCount ?? this.userInfo.favouritesCount,
      description: newUserInfo.description || this.userInfo.description,
      isBlueVerified: newUserInfo.isBlueVerified || this.userInfo.isBlueVerified,
      createdAt: newUserInfo.createdAt || this.userInfo.createdAt,
    };

    if (
      mergedInfo.username !== this.userInfo.username ||
      mergedInfo.displayName !== this.userInfo.displayName ||
      mergedInfo.avatarUrl !== this.userInfo.avatarUrl ||
      mergedInfo.userId !== this.userInfo.userId ||
      mergedInfo.followersCount !== this.userInfo.followersCount ||
      mergedInfo.friendsCount !== this.userInfo.friendsCount ||
      mergedInfo.statusesCount !== this.userInfo.statusesCount ||
      mergedInfo.isBlueVerified !== this.userInfo.isBlueVerified
    ) {
      this.userInfo = mergedInfo;
      console.log('[XUserStore] User info updated:', {
        username: mergedInfo.username,
        displayName: mergedInfo.displayName,
        userId: mergedInfo.userId,
        avatarUrl: mergedInfo.avatarUrl,
        followersCount: mergedInfo.followersCount,
        friendsCount: mergedInfo.friendsCount,
        statusesCount: mergedInfo.statusesCount,
        isBlueVerified: mergedInfo.isBlueVerified,
        createdAt: mergedInfo.createdAt,
      });
      this.notifyListeners();
    }
  }

  /**
   * 获取当前用户信息
   */
  getUserInfo(): XUserInfo {
    return this.userInfo;
  }

  /**
   * 获取当前用户名 (便捷方法)
   */
  getUsername(): string | null {
    return this.userInfo.username;
  }

  /**
   * 获取当前用户 ID (便捷方法)
   */
  getUserId(): string | null {
    return this.userInfo.userId;
  }

  /**
   * 订阅用户信息变化
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // 立即通知当前值
    listener(this.userInfo);
    // 返回取消订阅函数
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.userInfo));
  }
}

// 单例导出
export const xUserStore = new XUserStore();
