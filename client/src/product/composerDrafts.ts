/**
 * Per-conversation unsent text drafts.
 *
 * Drafts live in memory only. They are intentionally never written to storage: an unsent message is
 * plaintext and the vault must remain the only persistent home for conversation content. They are
 * keyed by room so text typed for one contact can never be submitted to another after a switch.
 */
const MAX_DRAFT_ROOMS = 64;

export class ComposerDrafts {
  private scope?: object;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<string, object>();
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly snapshot = (): number => this.version;
  private changed(): void { this.version++; this.listeners.forEach(listener => listener()); }
  bind(scope?: object): void {
    // Binding happens during parent selection; old children are about to unmount.
    if (scope !== this.scope) { this.drafts.clear(); this.pending.clear(); this.scope = scope; this.version++; }
  }
  isSending(roomId: string): boolean { return this.pending.has(roomId); }
  beginSend(roomId: string, scope?: object): object | undefined {
    if (!roomId || !this.boundTo(scope) || this.pending.has(roomId) || this.pending.size >= MAX_DRAFT_ROOMS) return undefined;
    const ticket = {}; this.pending.set(roomId, ticket); this.changed(); return ticket;
  }
  endSend(roomId: string, ticket: object, scope?: object): void {
    if (!this.boundTo(scope) || this.pending.get(roomId) !== ticket) return;
    this.pending.delete(roomId); this.changed();
  }
  boundTo(scope?: object): boolean { return scope !== undefined && this.scope === scope; }
  private readonly drafts = new Map<string, string>();

  get(roomId: string | undefined): string {
    return roomId ? this.drafts.get(roomId) ?? '' : '';
  }

  set(roomId: string | undefined, text: string): void {
    if (!roomId) return;
    if (!text.trim()) { this.drafts.delete(roomId); this.changed(); return; }
    // Re-insert so the Map iteration order is least-recently-updated first.
    this.drafts.delete(roomId);
    this.drafts.set(roomId, text);
    while (this.drafts.size > MAX_DRAFT_ROOMS) {
      const oldest = this.drafts.keys().next().value;
      if (oldest === undefined) break;
      this.drafts.delete(oldest);
    }
    this.changed();
  }

  /** Clears a draft only if it is still the text that was sent, so edits made mid-send survive. */
  clearIfUnchanged(roomId: string | undefined, sentText: string): boolean {
    if (!roomId || this.drafts.get(roomId) !== sentText) return false;
    this.drafts.delete(roomId); this.changed();
    return true;
  }

  clearAll(): void { this.drafts.clear(); this.pending.clear(); this.changed(); }
}
