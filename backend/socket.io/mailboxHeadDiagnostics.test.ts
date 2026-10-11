import { MailboxHeadDiagnostics, MAILBOX_HEAD_WARN_AGE_MS, MAILBOX_HEAD_WARNING_INTERVAL_MS, MAILBOX_HEAD_WARN_ATTEMPTS } from './mailboxHeadDiagnostics';

describe('mailbox FIFO head diagnostics', () => {
  it('warns on repeated claims without identifying a room, person, or message', () => {
    const warn = jest.fn(); const diagnostics = new MailboxHeadDiagnostics(warn);
    const now = 2_000_000;
    expect(diagnostics.observe('legacy', { deliveryAttempts: MAILBOX_HEAD_WARN_ATTEMPTS, timestamp: now }, now)).toBe(true);
    expect(warn).toHaveBeenCalledWith('offline_mailbox_fifo_head_delayed', {
      transport: 'legacy', attempts: MAILBOX_HEAD_WARN_ATTEMPTS, ageMinutes: 0, reason: 'attempts',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/room-secret|mailbox-secret|ciphertext|capability|private-key/i);
  });

  it('warns when a head is old even before reaching the attempt threshold', () => {
    const warn = jest.fn(); const diagnostics = new MailboxHeadDiagnostics(warn);
    const now = MAILBOX_HEAD_WARN_AGE_MS + 10_000;
    expect(diagnostics.observe('mux', { deliveryAttempts: 1, timestamp: 10_000 }, now)).toBe(true);
    expect(warn).toHaveBeenCalledWith('offline_mailbox_fifo_head_delayed', expect.objectContaining({ reason: 'age', attempts: 1 }));
  });

  it('deduplicates warnings for one minute, then permits another warning', () => {
    const warn = jest.fn(); const diagnostics = new MailboxHeadDiagnostics(warn);
    const head = { deliveryAttempts: MAILBOX_HEAD_WARN_ATTEMPTS, timestamp: 10_000 };
    expect(diagnostics.observe('legacy', head, 100_000)).toBe(true);
    expect(diagnostics.observe('legacy', head, 100_000 + MAILBOX_HEAD_WARNING_INTERVAL_MS - 1)).toBe(false);
    expect(diagnostics.observe('legacy', head, 100_000 + MAILBOX_HEAD_WARNING_INTERVAL_MS)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
