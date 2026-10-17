type SetupAction = 'invitation' | 'contact' | 'join';
type SafeSetupError = { status?: unknown; retryAfterMs?: unknown; name?: unknown; message?: unknown };

const safeError = (error: unknown): SafeSetupError =>
  error && typeof error === 'object' ? error as SafeSetupError : {};

/** Maps allowlisted error facts to UI copy; never reflects server bodies or user input. */
export const setupErrorMessage = (error: unknown, action: SetupAction): string => {
  const value = safeError(error);
  const status = typeof value.status === 'number' ? value.status : undefined;
  const retryAfterMs = typeof value.retryAfterMs === 'number' && Number.isFinite(value.retryAfterMs)
    ? value.retryAfterMs : undefined;

  if (status === 429) {
    const seconds = retryAfterMs !== undefined && retryAfterMs > 0 && retryAfterMs <= 60_000
      ? Math.max(1, Math.ceil(retryAfterMs / 1_000)) : undefined;
    return seconds
      ? `K3NCRYPT is receiving requests too quickly. Wait about ${seconds} seconds, then retry.`
      : 'K3NCRYPT is receiving requests too quickly. Wait a moment, then retry.';
  }
  if (status === 503) return 'K3NCRYPT is starting or its secure storage is unavailable. Wait a moment, then retry.';
  if (status === 404 || status === 502 || status === 504 || error instanceof TypeError) {
    return 'Could not reach the K3NCRYPT service. Check your connection, then retry.';
  }
  if (status === 401 || status === 403) return 'This device could not authorize the request. Unlock it and try again.';
  if (error instanceof Error && error.message === 'A passphrase or password must contain between 12 and 1024 characters.') {
    return 'Choose a passphrase with at least 12 characters.';
  }
  if (value.name === 'QuotaExceededError') return 'This browser is out of secure storage space. Free local space, then retry.';
  if (error instanceof Error && error.message === 'Invalid unlock secret') return 'The local passphrase did not unlock this device.';
  if (status === 410) {
    return action === 'join'
      ? 'This invitation has expired. Ask your contact to create a new one.'
      : 'This invitation is no longer available. Create a fresh invitation and retry.';
  }
  if (status === 400 || status === 409) {
    return action === 'join'
      ? 'This invitation could not be accepted. Check that it is current and intended for this contact.'
      : 'K3NCRYPT could not complete this request. Check the contact state, then retry.';
  }
  if (action === 'invitation') return 'Could not create an invitation. Check the K3NCRYPT service and retry.';
  if (action === 'join') return 'Could not open this contact. Check the invitation and your local device, then retry.';
  return 'Could not create this contact. Check the K3NCRYPT service and your local device, then retry.';
};
