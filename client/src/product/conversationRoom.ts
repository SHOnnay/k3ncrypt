import { rateLimitedRequest } from '../../../service/src/api/rateLimitedRequest';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { ConversationDescriptor } from './sessionStore';
import type { SafeDiagnosticCode } from './safeDiagnostics';
/** Only authoritative room states quarantine. Offline availability is not corruption. */
export async function probeConversationRoom(descriptor: ConversationDescriptor): Promise<SafeDiagnosticCode | undefined> {
  try {
    const response = await rateLimitedRequest(() => fetch(`${getRuntimeConfig().baseUrl ?? ''}/api/chat-link/status/${encodeURIComponent(descriptor.roomId)}`, { headers: { 'X-K3ncrypt-Control-Capability': descriptor.controlCapability } }));
    if (response.ok) return undefined;
    if (response.status !== 404 && response.status !== 410) return undefined;
    const reader = response.body?.getReader(); if (!reader) return undefined;
    let text = ''; let length = 0; const decoder = new TextDecoder();
    try {
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 2048) { await reader.cancel(); return undefined; } text += decoder.decode(part.value, { stream: true }); }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || !('state' in body)) return undefined;
    return body.state === 'EXPIRED' ? 'CONVERSATION_INVITATION_EXPIRED' : body.state === 'DELETED' || body.state === 'NOT_FOUND' ? 'CONVERSATION_ROOM_MISSING' : undefined;
  } catch { return undefined; }
}
