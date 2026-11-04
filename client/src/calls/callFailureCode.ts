/**
 * Part A2 bug 6: which path a call setup failure took, as a fixed code. Only our own fixed error strings
 * and DOMException names are mapped; no message text, device label or identifier is kept.
 */
const PATTERNS: [RegExp, string][] = [
  [/required call state/i, 'CALL_STATE_NOT_READY'],
  [/media is not prepared/i, 'CALL_MEDIA_NOT_PREPARED'],
  [/authenticated call media is not ready/i, 'CALL_SUPPORT_NOT_READY'],
  [/request was cancelled/i, 'CALL_CAPTURE_CANCELLED'],
  [/in use by another app/i, 'CALL_DEVICE_BUSY'],
  [/permission was denied or dismissed/i, 'CALL_PERMISSION'],
  [/camera or microphone is unavailable|microphone is unavailable/i, 'CALL_DEVICE_MISSING'],
  [/check the device and page permissions/i, 'CALL_CAPTURE_UNAVAILABLE'],
  [/offer rejected|answer rejected/i, 'CALL_OFFER_REJECTED'],
  [/device trust/i, 'CALL_DEVICE_TRUST'],
  [/checked contact|verification|identity/i, 'CALL_CHECK_NEEDED'],
];
const SAFE_NAME = /^[A-Za-z]{1,40}Error$/;

export const callFailureCode = (error: unknown): string => {
  if (!(error instanceof Error)) return 'CALL_OTHER';
  const match = PATTERNS.find(([pattern]) => pattern.test(error.message));
  if (match) return match[1];
  return SAFE_NAME.test(error.name) && error.name !== 'Error' ? `CALL_OTHER_${error.name}` : 'CALL_OTHER';
};

export type CallFailureStage = 'caller-prepare' | 'caller-offer' | 'callee-accept';
let last: { stage: CallFailureStage; code: string; at: number } | undefined;

export const recordCallFailure = (stage: CallFailureStage, error: unknown): void => {
  last = { stage, code: callFailureCode(error), at: Date.now() };
  console.warn('[K3NCRYPT]', { event: 'call_setup_failed', stage, reason: last.code });
};
export const lastCallFailure = () => last;
