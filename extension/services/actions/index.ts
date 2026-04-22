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
// tiktokHandlers removed — fetch_tiktok_video orphan deleted with the
// abandoned republish flow.
// xiaohongshuHandlers removed — fetch_xiaohongshu_note orphan deleted
// with the abandoned republish flow. New publish-to-XHS feature will
// use a different action shape.
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
  engagementHandlers,
};
