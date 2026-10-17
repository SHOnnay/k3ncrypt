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
  bind(scope?: object): void { if (scope !== this.scope) { this.clearAll(); this.scope = scope; } }
  boundTo(scope?: object): boolean { return scope !== undefined && this.scope === scope; }
  private readonly drafts = new Map<string, string>();

  get(roomId: string | undefined): string {
    return roomId ? this.drafts.get(roomId) ?? '' : '';
  }

  set(roomId: string | undefined, text: string): void {
    if (!roomId) return;
    if (!text.trim()) { this.drafts.delete(roomId); return; }
    // Re-insert so the Map iteration order is least-recently-updated first.
    this.drafts.delete(roomId);
    this.drafts.set(roomId, text);
    while (this.drafts.size > MAX_DRAFT_ROOMS) {
      const oldest = this.drafts.keys().next().value;
      if (oldest === undefined) break;
      this.drafts.delete(oldest);
    }
  }

  /** Clears a draft only if it is still the text that was sent, so edits made mid-send survive. */
  clearIfUnchanged(roomId: string | undefined, sentText: string): boolean {
    if (!roomId || this.drafts.get(roomId) !== sentText) return false;
    this.drafts.delete(roomId);
    return true;
  }

  clearAll(): void { this.drafts.clear(); }
}
