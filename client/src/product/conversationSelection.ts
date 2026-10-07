/** Serialize candidate opens; failed resolution never commits UI/session selection. */
export class ConversationSelection {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(resolve: () => Promise<T>, commit: (candidate: T) => Promise<void>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(async () => { const candidate = await resolve(); await commit(candidate); return candidate; });
    this.queue = next; return next;
  }
}
