export type ConversationProtocol = 'legacy' | 'modern';

export interface ContactVisibilitySource {
  verification?: 'unknown' | 'unverified' | 'verified';
  changeStatus?: 'unchanged' | 'changed-pending-review';
}

export type VerificationVisibility = 'verified' | 'unverified' | 'unknown';
export type IdentityChangeVisibility = 'unchanged' | 'changed-pending-review' | 'unknown';
export type SessionVisibility = 'healthy' | 'unhealthy' | 'renewal-pending' | 'unknown';

export interface SecurityVisibilitySnapshot {
  verification: VerificationVisibility;
  identityChange: IdentityChangeVisibility;
  transport: 'relay';
  relayAvailability: 'not-exposed';
  session: SessionVisibility;
  badgeLabel: string;
}

export type MessageVisibilityState =
  | 'pending'
  | 'relay-accepted-outcome-unknown'
  | 'recipient-app-accepted-relay-reported'
  | 'could-not-confirm'
  | 'held-not-sent-securely'
  | 'unknown';

export interface MessageDeliveryVisibility {
  state: MessageVisibilityState;
  label: string;
  summaryLabel: string;
  explanation: string;
}

export const deriveSecurityVisibility = (input: {
  contact?: ContactVisibilitySource | null;
  sessionHealth?: 'healthy' | 'unhealthy' | 'renewal-pending';
  protocol: ConversationProtocol;
}): SecurityVisibilitySnapshot => {
  const identityChange: IdentityChangeVisibility = input.contact?.changeStatus === 'unchanged'
    ? 'unchanged'
    : input.contact?.changeStatus === 'changed-pending-review' ? 'changed-pending-review' : 'unknown';
  const verification: VerificationVisibility = identityChange === 'changed-pending-review'
    ? 'unverified'
    : input.contact?.changeStatus === 'unchanged' && input.contact.verification === 'verified' ? 'verified'
      : input.contact?.changeStatus === 'unchanged' && input.contact.verification === 'unverified' ? 'unverified' : 'unknown';
  const session: SessionVisibility = input.protocol === 'modern' ? input.sessionHealth ?? 'unknown' : 'unknown';

  return {
    verification,
    identityChange,
    transport: 'relay',
    relayAvailability: 'not-exposed',
    session,
    badgeLabel: identityChange === 'changed-pending-review' ? 'Identity changed · review required'
      : verification === 'verified' ? 'Verified'
        : verification === 'unverified' ? 'Unverified' : 'Verification status unavailable',
  };
};

export const deriveMessageDeliveryVisibility = (
  delivery: 'pending' | 'accepted' | 'failed' | 'held' | undefined,
  protocol: ConversationProtocol,
): MessageDeliveryVisibility => {
  if (delivery === 'pending') {
    return {
      state: 'pending',
      label: 'Pending on this device',
      summaryLabel: 'Sending…',
      explanation: 'This message remains pending on this device. The available state does not show whether the relay accepted it or whether the recipient received it.',
    };
  }
  if (delivery === 'accepted' && protocol === 'modern') {
    return {
      state: 'recipient-app-accepted-relay-reported',
      label: 'Recipient app accepted · relay report',
      summaryLabel: 'Sent',
      explanation: 'The relay reports that the recipient application accepted this message. This is not a signed peer receipt and does not show that it was displayed or read.',
    };
  }
  if (delivery === 'accepted') {
    return {
      state: 'relay-accepted-outcome-unknown',
      label: 'Sent · recipient not confirmed',
      summaryLabel: 'Sent',
      explanation: 'The relay acknowledged this message. This client does not distinguish live recipient acceptance from mailbox storage, and has no authenticated peer receipt.',
    };
  }
  if (delivery === 'failed') {
    return {
      state: 'could-not-confirm',
      label: 'Could not confirm · Retry',
      summaryLabel: 'Failed · Retry',
      explanation: 'The send operation did not complete with a confirmed result. A timeout can leave the relay outcome unknown.',
    };
  }
  if (delivery === 'held') {
    return {
      state: 'held-not-sent-securely',
      label: 'Not sent — retry required',
      summaryLabel: 'Not sent — retry required',
      explanation: 'This message was held on this device because the conversation now requires a newer secure message format. Retry creates a new encrypted message; the old message was not sent again.',
    };
  }
  return {
    state: 'unknown',
    label: 'Status unavailable',
    summaryLabel: 'Status unavailable',
    explanation: 'No delivery state is available for this message.',
  };
};
