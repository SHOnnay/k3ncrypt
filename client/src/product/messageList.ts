import type { Message } from '../types/index';

/**
 * Stable React keys for the message list. Bubbles hold per-message state (a downloaded file, an
 * opened preview), so keys must follow the message, never its position: an index key lets a verified
 * file or photo preview attach to a different message when the list changes (room switch, a failed
 * message being retried and re-appended). Duplicate ids get a numbered suffix so keys stay unique.
 */
export const messageKeys = (messages: readonly Pick<Message, 'id'>[], roomId = ''): string[] => {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const base = message.id || 'message';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return JSON.stringify([roomId, base, count]);
  });
};

export type ScrollAction = 'none' | 'instant' | 'smooth';

const NEAR_BOTTOM_PX = 120;
export const isNearBottom = (scrollHeight: number, scrollTop: number, clientHeight: number): boolean =>
  scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX;

/**
 * Decides how the list follows new content.
 * - First paint of a room: jump to the latest message without a long animated scroll through history.
 * - A message the user sent: always follow it.
 * - A message received while reading older history, or an in-place status change: leave the scroll alone.
 */
export const decideScroll = (input: {
  roomChanged: boolean;
  previousLastId: string | undefined;
  lastId: string | undefined;
  lastIsOwn: boolean;
  nearBottom: boolean;
}): ScrollAction => {
  if (input.roomChanged) return 'instant';
  if (input.lastId === undefined || input.lastId === input.previousLastId) return 'none';
  if (input.previousLastId === undefined) return 'instant';
  if (input.lastIsOwn || input.nearBottom) return 'smooth';
  return 'none';
};
