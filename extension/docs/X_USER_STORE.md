# XUserStore - Twitter 用户信息存储

## 概述

`XUserStore` 是一个全局单例，用于从 Twitter 页面获取当前登录用户的信息并缓存。它结合了 **DOM 解析** 和 **`__INITIAL_STATE__` 解析** 两种方式，获取完整的用户数据。

## 文件位置

```
stores/xUserStore.ts
```

## 数据来源

### 1. DOM 解析

从页面 DOM 元素获取基础信息：

| 数据 | DOM 来源 |
|------|----------|
| username | `a[data-testid="AppTabBar_Profile_Link"]` 的 href |
| displayName | 头像 img 的 alt 属性 |
| avatarUrl | `img[src*="profile_images"]` 的 src |

### 2. `__INITIAL_STATE__` 解析

Twitter 页面在 `<script>` 标签中嵌入了 `window.__INITIAL_STATE__`，包含丰富的用户数据：

```javascript
window.__INITIAL_STATE__ = {
  session: {
    user_id: "1262375832112242691"  // 当前登录用户 ID
  },
  entities: {
    users: {
      entities: {
        "1262375832112242691": {
          followers_count: 3927,
          friends_count: 1289,
          statuses_count: 959,
          is_blue_verified: true,
          profile_image_url_https: "https://pbs.twimg.com/profile_images/xxx.jpg",
          // ...更多字段
        }
      }
    }
  }
}
```

## 关键实现细节

### Content Script 隔离问题

**问题**：Chrome 扩展的 Content Script 运行在隔离的 world 中，无法直接访问页面主 world 的 `window.__INITIAL_STATE__`。

**解决方案**：从 DOM 中的 `<script>` 标签解析 JSON：

```typescript
private parseInitialStateFromDOM(): any | null {
  try {
    const scripts = document.querySelectorAll('script[type="text/javascript"]');
    for (const script of scripts) {
      const content = script.textContent || '';
      if (content.includes('window.__INITIAL_STATE__=')) {
        const startIndex = content.indexOf('window.__INITIAL_STATE__=') + 'window.__INITIAL_STATE__='.length;
        let endIndex = content.indexOf('};', startIndex) + 1;
        if (endIndex <= startIndex) {
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
```

### 用户 ID 来源

**注意**：头像 URL 中的数字是**图片 ID**，不是用户 ID！

```
❌ profile_images/1799998493190430721/xxx.jpg  → 这是图片 ID
✅ session.user_id: "1262375832112242691"      → 这是真正的用户 ID
```

正确做法是从 `__INITIAL_STATE__.session.user_id` 获取用户 ID。

## 数据结构

```typescript
export interface XUserInfo {
  // 基础信息（DOM + __INITIAL_STATE__）
  username: string | null;      // 用户名 (如 jackleeio)
  displayName: string | null;   // 显示名 (如 Jack Lee)
  avatarUrl: string | null;     // 头像 URL
  userId: string | null;        // 用户 ID (数字字符串)
  isBlueVerified: boolean;      // 是否蓝V认证

  // 扩展信息（仅从 __INITIAL_STATE__ 获取）
  followersCount: number | null;   // 粉丝数
  friendsCount: number | null;     // 关注数
  statusesCount: number | null;    // 推文数
  favouritesCount: number | null;  // 喜欢数
  description: string | null;      // 个人简介
  createdAt: string | null;        // 账号创建时间
}
```

## 控制台输出示例

```javascript
[XUserStore] User info updated: {
  username: "jackleeio",
  displayName: "Jack Lee",
  userId: "1262375832112242691",
  avatarUrl: "https://pbs.twimg.com/profile_images/1799998493190430721/QmU3dVow_normal.jpg",
  followersCount: 3927,
  friendsCount: 1289,
  statusesCount: 959,
  isBlueVerified: true,
  createdAt: "2020-05-18T13:34:05.000Z"
}
```

## 使用方法

### 初始化

在应用启动时调用：

```typescript
import { xUserStore } from './stores/xUserStore';

// 初始化（会自动每 2 秒更新一次）
xUserStore.init();
```

### 获取用户信息

```typescript
// 获取完整用户信息
const userInfo = xUserStore.getUserInfo();
console.log('Followers:', userInfo.followersCount);  // 3927
console.log('Following:', userInfo.friendsCount);    // 1289

// 便捷方法
const username = xUserStore.getUsername();  // "jackleeio"
const userId = xUserStore.getUserId();      // "1262375832112242691"
```

### 订阅变化

```typescript
// 订阅用户信息变化
const unsubscribe = xUserStore.subscribe((userInfo) => {
  console.log('User info updated:', userInfo);
  console.log('Followers:', userInfo.followersCount);
});

// 取消订阅
unsubscribe();
```

### React Hook 使用

```typescript
import { useXUsername } from './hooks/useXUsername';

function MyComponent() {
  const { userInfo, username } = useXUsername();

  return (
    <div>
      <p>用户: {userInfo?.displayName}</p>
      <p>粉丝: {userInfo?.followersCount}</p>
    </div>
  );
}
```

## 数据更新机制

1. **初始化时**：立即尝试获取用户信息
2. **定时轮询**：每 2 秒检查一次，处理页面加载延迟和用户切换
3. **变化检测**：只有数据变化时才通知订阅者

## 注意事项

1. **页面加载时机**：`__INITIAL_STATE__` 只在页面初次加载时存在，SPA 导航后可能不更新
2. **数据一致性**：DOM 数据和 `__INITIAL_STATE__` 数据合并时，userId 优先使用 `__INITIAL_STATE__` 的值
3. **错误处理**：解析失败时返回空对象，不会阻断其他数据获取
