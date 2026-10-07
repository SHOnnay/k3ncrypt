import { probeConversationRoom } from './conversationRoom';
jest.mock('../config/runtimeConfig', () => ({ getRuntimeConfig: () => ({ baseUrl: '' }) }));
const descriptor = { version: 1 as const, roomId: '11111111-1111-4111-8111-111111111111', controlCapability: 'a'.repeat(43), label: 'Private contact', updatedAt: 1 };
afterEach(() => jest.restoreAllMocks());
it('uses authoritative expiry/deletion responses and treats offline failure as availability, not corruption', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  fetch.mockResolvedValueOnce(new Response('{"state":"EXPIRED"}', { status: 404 }));
  expect(await probeConversationRoom(descriptor)).toBe('CONVERSATION_INVITATION_EXPIRED');
  fetch.mockResolvedValueOnce(new Response('{"state":"DELETED"}', { status: 410 }));
  expect(await probeConversationRoom(descriptor)).toBe('CONVERSATION_ROOM_MISSING');
  fetch.mockRejectedValueOnce(new TypeError('Network unavailable'));
  expect(await probeConversationRoom(descriptor)).toBeUndefined();
  fetch.mockResolvedValueOnce(new Response('x'.repeat(2049), { status: 404 }));
  expect(await probeConversationRoom(descriptor)).toBeUndefined();
});
