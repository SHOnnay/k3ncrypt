/** Serialize candidate opens; failed resolution never commits UI/session selection. */
export class ConversationSelection {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(resolve: () => Promise<T>, commit: (candidate: T) => Promise<void>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(async () => { const candidate = await resolve(); await commit(candidate); return candidate; });
    this.queue = next; return next;
  }
}

/** Load room-bound UI data first; a superseded load must not partially project a room. */
export async function commitPreparedSelection<T>(
  load: () => Promise<T>, current: () => boolean, commit: (value: T) => void,
): Promise<T> {
  const value = await load();
  if (!current()) throw new Error('Conversation open was superseded.');
  // No asynchronous boundary between the fence and the UI projection.
  commit(value);
  return value;
}
