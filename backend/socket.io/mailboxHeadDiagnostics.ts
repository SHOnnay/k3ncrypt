/** Safe, aggregate-only warnings for repeatedly retried/aging FIFO heads. */
export const MAILBOX_HEAD_WARN_ATTEMPTS = 5;
export const MAILBOX_HEAD_WARN_AGE_MS = 15 * 60_000;
export const MAILBOX_HEAD_WARNING_INTERVAL_MS = 60_000;

type HeadObservation = { deliveryAttempts?: number; timestamp?: number };
type Transport = 'legacy' | 'mux';

export class MailboxHeadDiagnostics {
  private lastWarningAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly warn: (event: string, fields: Record<string, number | string>) => void) {}

  observe(transport: Transport, head: HeadObservation, now = Date.now()): boolean {
    const attempts = Number.isSafeInteger(head.deliveryAttempts) && (head.deliveryAttempts ?? 0) >= 0
      ? Math.min(head.deliveryAttempts!, 1_000_000) : 0;
    const timestamp = Number.isFinite(head.timestamp) ? head.timestamp! : now;
    const ageMs = Math.max(0, now - timestamp);
    const attemptThreshold = attempts >= MAILBOX_HEAD_WARN_ATTEMPTS;
    const ageThreshold = ageMs >= MAILBOX_HEAD_WARN_AGE_MS;
    if ((!attemptThreshold && !ageThreshold) || now - this.lastWarningAt < MAILBOX_HEAD_WARNING_INTERVAL_MS) return false;

    this.lastWarningAt = now;
    this.warn('offline_mailbox_fifo_head_delayed', {
      transport,
      attempts,
      ageMinutes: Math.min(Math.floor(ageMs / 60_000), 1_000_000),
      reason: attemptThreshold && ageThreshold ? 'attempts_and_age' : attemptThreshold ? 'attempts' : 'age',
    });
    return true;
  }
}

const mailboxHeadDiagnostics = new MailboxHeadDiagnostics((event, fields) => console.warn(event, fields));
export const observeMailboxHead = (transport: Transport, head: HeadObservation): boolean => mailboxHeadDiagnostics.observe(transport, head);
