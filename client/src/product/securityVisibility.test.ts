import { deriveMessageDeliveryVisibility, deriveSecurityVisibility } from './securityVisibility';

describe('deriveSecurityVisibility', () => {
  it('shows verified only for an explicitly verified unchanged contact', () => {
    expect(deriveSecurityVisibility({ contact: { verification: 'verified', changeStatus: 'unchanged' }, protocol: 'modern' }))
      .toMatchObject({ verification: 'verified', identityChange: 'unchanged', badgeLabel: 'Verified', transport: 'relay' });
  });

  it('keeps an unchanged unverified contact unverified', () => {
    expect(deriveSecurityVisibility({ contact: { verification: 'unverified', changeStatus: 'unchanged' }, protocol: 'modern' }))
      .toMatchObject({ verification: 'unverified', badgeLabel: 'Unverified' });
  });

  it('makes an identity change a review state even if stale data says verified', () => {
    expect(deriveSecurityVisibility({ contact: { verification: 'verified', changeStatus: 'changed-pending-review' }, protocol: 'modern' }))
      .toMatchObject({ verification: 'unverified', identityChange: 'changed-pending-review', badgeLabel: 'Identity changed · review required' });
  });

  it('does not infer verification or session health from absent state', () => {
    expect(deriveSecurityVisibility({ protocol: 'legacy' }))
      .toMatchObject({ verification: 'unknown', identityChange: 'unknown', session: 'unknown', badgeLabel: 'Verification status unavailable' });
  });
});

describe('deriveMessageDeliveryVisibility', () => {
  it('keeps pending messages neutral and does not invent an active retry state', () => {
    expect(deriveMessageDeliveryVisibility('pending', 'modern'))
      .toMatchObject({ state: 'pending', label: 'Pending on this device', summaryLabel: 'Sending…' });
  });

  it('distinguishes a relay acknowledgement from a recipient-acceptance report', () => {
    expect(deriveMessageDeliveryVisibility('accepted', 'legacy'))
      .toMatchObject({ state: 'relay-accepted-outcome-unknown', label: 'Sent · recipient not confirmed' });
    expect(deriveMessageDeliveryVisibility('accepted', 'modern'))
      .toMatchObject({ state: 'recipient-app-accepted-relay-reported', label: 'Recipient app accepted · relay report', summaryLabel: 'Sent' });
  });

  it('keeps technical acceptance evidence available for optional message details', () => {
    const visibility = deriveMessageDeliveryVisibility('accepted', 'modern');
    expect(visibility.summaryLabel).toBe('Sent');
    expect(visibility.explanation).toMatch(/relay reports.*not a signed peer receipt/i);
    expect(visibility.label).toBe('Recipient app accepted · relay report');
  });

  it('does not call relay-reported acceptance delivered or persisted by the peer', () => {
    const visibility = deriveMessageDeliveryVisibility('accepted', 'modern');
    expect(visibility.label).not.toMatch(/delivered|persisted/i);
    expect(visibility.explanation).toMatch(/not a signed peer receipt/i);
  });

  it('keeps a failed or unknown outcome non-optimistic', () => {
    expect(deriveMessageDeliveryVisibility('failed', 'legacy'))
      .toMatchObject({ state: 'could-not-confirm', label: 'Could not confirm · Retry' });
    expect(deriveMessageDeliveryVisibility(undefined, 'modern'))
      .toMatchObject({ state: 'unknown', label: 'Status unavailable' });
  });
});
