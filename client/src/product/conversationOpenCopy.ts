import type { SafeDiagnosticCode } from './safeDiagnostics';

export interface OpenState {
  pending?: { roomId: string } | undefined;
  error?: { roomId: string; code?: SafeDiagnosticCode } | undefined;
}

/**
 * Honest, short status for a conversation row: it only claims "Opening" while an open is genuinely in
 * flight for that room, and only claims a failure when one was recorded. Returns undefined otherwise
 * so the row keeps its normal description.
 */
export const conversationRowOpenStatus = (roomId: string, state: OpenState): string | undefined => {
  if (state.pending?.roomId === roomId) return 'Opening…';
  if (state.error?.roomId === roomId) {
    return state.error.code === 'NETWORK_FAILURE' || state.error.code === 'SERVICE_NOT_READY'
      ? 'Couldn’t reach the server — tap to retry'
      : 'Couldn’t open — tap to retry';
  }
  return undefined;
};

/** Status line for the main area when no conversation is open yet (so the screen never looks frozen). */
export const emptyStateOpenStatus = (state: OpenState, labelFor: (roomId: string) => string): { kind: 'opening' | 'failed'; text: string } | undefined => {
  if (state.pending) return { kind: 'opening', text: `Opening ${labelFor(state.pending.roomId)}… Your saved messages stay on this device.` };
  if (state.error) {
    const offline = state.error.code === 'NETWORK_FAILURE' || state.error.code === 'SERVICE_NOT_READY';
    return { kind: 'failed', text: offline
      ? `Couldn’t reach the server to open ${labelFor(state.error.roomId)}. The server may be waking up — try again in a moment.`
      : `Couldn’t open ${labelFor(state.error.roomId)}. Select it again to retry.` };
  }
  return undefined;
};
