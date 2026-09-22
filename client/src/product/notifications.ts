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
  const preview = (event.kind === 'message' || event.kind === 'group-message') && preferences.notificationPreviews && event.preview ? event.preview.slice(0, 120) : genericBody[event.kind];
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
