import { rateLimitedRequest } from '../../../service/src/api/rateLimitedRequest';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { ConversationDescriptor } from './sessionStore';
import type { SafeDiagnosticCode } from './safeDiagnostics';

/** Read-only status lookup for legacy invitations that predate signed local expiry metadata. */
export async function probeInvitationExpiry(descriptor: ConversationDescriptor): Promise<number | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await rateLimitedRequest(() => fetch(`${getRuntimeConfig().baseUrl ?? ''}/api/chat-link/status/${encodeURIComponent(descriptor.roomId)}`, {
      signal: controller.signal,
      headers: { 'X-K3ncrypt-Control-Capability': descriptor.controlCapability },
    }), controller.signal);
    if (!response.ok) return undefined;
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    let text = ''; let length = 0; const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > 2048) { await reader.cancel(); return undefined; }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || !('invitation' in body) || !body.invitation || typeof body.invitation !== 'object' || !('expiresAt' in body.invitation)) return undefined;
    const expiresAt = body.invitation.expiresAt;
    return Number.isSafeInteger(expiresAt) && (expiresAt as number) >= 0 ? expiresAt as number : undefined;
  } catch { return undefined; }
  finally { clearTimeout(timeout); }
}

/** Only authoritative room states quarantine. Offline availability is not corruption. */
export async function probeConversationRoom(descriptor: ConversationDescriptor): Promise<SafeDiagnosticCode | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await rateLimitedRequest(() => fetch(`${getRuntimeConfig().baseUrl ?? ''}/api/chat-link/status/${encodeURIComponent(descriptor.roomId)}`, { signal: controller.signal, headers: { 'X-K3ncrypt-Control-Capability': descriptor.controlCapability } }), controller.signal);
    if (response.ok) return undefined;
    if (response.status === 503) return 'SERVICE_NOT_READY';
    if (response.status === 401 || response.status === 403) return 'VERIFICATION_REQUIRED';
    if (response.status !== 404 && response.status !== 410) return 'NETWORK_FAILURE';
    const reader = response.body?.getReader(); if (!reader) return undefined;
    let text = ''; let length = 0; const decoder = new TextDecoder();
    try {
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 2048) { await reader.cancel(); return undefined; } text += decoder.decode(part.value, { stream: true }); }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || !('state' in body)) return undefined;
    return body.state === 'EXPIRED' ? 'CONVERSATION_INVITATION_EXPIRED' : body.state === 'DELETED' || body.state === 'NOT_FOUND' ? 'CONVERSATION_ROOM_MISSING' : undefined;
  } catch { return 'NETWORK_FAILURE'; }
  finally { clearTimeout(timeout); }
}
