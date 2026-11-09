import type { PrivacyPreferences } from './preferences';

export type ProductNotification =
  | { kind: 'message' | 'group-message'; conversationId: string; sender?: string; preview?: string }
  | { kind: 'incoming-call' | 'missed-call' | 'security'; conversationId?: string };

export type NotificationPayload = { title: 'K3NCRYPT'; body: string; tag: string; silent?: boolean };
export interface NotificationBoundary { show(payload: NotificationPayload): void; }

const genericBody: Record<ProductNotification['kind'], string> = {
  message: 'New message', 'group-message': 'New group message', 'incoming-call': 'Incoming call', 'missed-call': 'Missed call', security: 'Security update',
};

/** Produces metadata-minimizing notification text after a client event is authenticated. */
export const notificationPayload = (event: ProductNotification, preferences: PrivacyPreferences): NotificationPayload | undefined => {
  if (!preferences.notificationsEnabled || (event.conversationId && preferences.mutedConversations.includes(event.conversationId))) return undefined;
  // N1: never message content unless previews are on. The local contact name (kept only on this device) may name the sender.
  const messageEvent = event.kind === 'message' || event.kind === 'group-message' ? event : undefined;
  const sender = messageEvent?.sender?.trim().slice(0, 40) ?? '';
  const preview = messageEvent && preferences.notificationPreviews && messageEvent.preview ? messageEvent.preview.slice(0, 120) : sender ? `${genericBody[event.kind]} from ${sender}` : genericBody[event.kind];
  return { title: 'K3NCRYPT', body: preview, tag: `k3ncrypt:${event.kind}:${event.conversationId ?? 'account'}`, silent: event.kind === 'incoming-call' };
};

export const browserNotificationBoundary = (): NotificationBoundary | undefined => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return undefined;
  return { show: (payload) => { new Notification(payload.title, { body: payload.body, tag: payload.tag, silent: payload.silent }); } };
};

export const deliverNotification = (event: ProductNotification, preferences: PrivacyPreferences, boundary = browserNotificationBoundary()): boolean => {
  const payload = notificationPayload(event, preferences);
  if (!payload || !boundary) return false;
  boundary.show(payload);
  return true;
};
