/**
 * Action Handlers Index
 * 统一导出所有 Action Handlers
 */

import { ActionHandler } from '../../types/action';
import { navigationHandlers } from './navigationActions';
import { replyHandlers } from './replyActions';
import { tweetHandlers } from './tweetActions';
import { articleHandlers } from './articleActions';
import { scrapeHandlers } from './scrapeActions';
import { searchHandlers } from './searchActions';
import { scrollHandlers } from './scrollActions';
import { wechatHandlers } from './wechatActions';
import { tiktokHandlers } from './tiktokActions';
import { xiaohongshuHandlers } from './xiaohongshuActions';
import { engagementHandlers } from './engagementActions';

/**
 * 所有 Action Handlers 的统一映射
 */
export const allHandlers: Record<string, ActionHandler> = {
  ...navigationHandlers,
  ...replyHandlers,
  ...tweetHandlers,
  ...articleHandlers,
  ...scrapeHandlers,
  ...searchHandlers,
  ...scrollHandlers,
  ...wechatHandlers,
  ...tiktokHandlers,
  ...xiaohongshuHandlers,
  ...engagementHandlers,
};

/**
 * 获取所有已注册的 Action IDs
 */
export function getRegisteredActionIds(): string[] {
  return Object.keys(allHandlers);
}

/**
 * 检查 Action 是否已注册
 */
export function isActionRegistered(actionId: string): boolean {
  return actionId in allHandlers;
}

/**
 * 导出各类别的 handlers
 */
export {
  navigationHandlers,
  replyHandlers,
  tweetHandlers,
  articleHandlers,
  scrapeHandlers,
  searchHandlers,
  scrollHandlers,
  wechatHandlers,
  tiktokHandlers,
  xiaohongshuHandlers,
  engagementHandlers,
};
