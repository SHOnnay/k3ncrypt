/** N1: when an incoming message should make a sound, raise a notification or count as unread. Pure; no DOM access. */

export interface ReceiveContext {
  readonly roomId: string;
  /** The chat currently open on screen, if any. */
  readonly openRoomId?: string;
  /** False when the tab or app is in the background. */
  readonly pageVisible: boolean;
  readonly muted: boolean;
  readonly soundsEnabled: boolean;
  readonly notificationsEnabled: boolean;
}

export interface ReceivePlan { readonly unread: boolean; readonly sound: boolean; readonly notify: boolean; }

/**
 * Unread: the person has not had this chat in front of them. Sound: same condition, unless muted.
 * Notification: only while the page is hidden, unless muted. Mute never hides the unread badge.
 */
export const planIncomingMessage = (context: ReceiveContext): ReceivePlan => {
  const inView = context.pageVisible && context.openRoomId === context.roomId;
  return {
    unread: !inView,
    sound: !inView && !context.muted && context.soundsEnabled,
    notify: !context.pageVisible && !context.muted && context.notificationsEnabled,
  };
};

export type UnreadCounts = Readonly<Record<string, number>>;
const MAX_COUNT = 999;

export const addUnread = (counts: UnreadCounts, roomId: string): UnreadCounts => ({ ...counts, [roomId]: Math.min(MAX_COUNT, (counts[roomId] ?? 0) + 1) });
export const clearUnread = (counts: UnreadCounts, roomId: string): UnreadCounts => {
  if (!counts[roomId]) return counts;
  const { [roomId]: _removed, ...rest } = counts;
  return rest;
};
export const totalUnread = (counts: UnreadCounts): number => Object.values(counts).reduce((sum, value) => sum + value, 0);
export const badgeLabel = (count: number): string => count > 99 ? '99+' : String(count);
export const tabTitle = (baseTitle: string, total: number): string => total > 0 ? `(${badgeLabel(total)}) ${baseTitle}` : baseTitle;

/** Ask once, after the first chat exists, and only while the browser still has no answer. */
export const shouldOfferNotificationPermission = (state: { permission: NotificationPermission | 'unsupported'; hasChat: boolean; alreadyOffered: boolean }): boolean =>
  state.permission === 'default' && state.hasChat && !state.alreadyOffered;
