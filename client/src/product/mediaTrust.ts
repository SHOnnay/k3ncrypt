/**
 * Legacy v1 media (`k3ncrypt-media-v1:`) is file transfer too. Invariant: calls and
 * file transfer require a verified, unchanged identity (P0-1b). The relay route stays
 * mounted for Android compatibility, so the web client enforces this before any fetch.
 */
export async function receiveLegacyMediaFromVerifiedContact<T>(
  requireVerifiedContact: () => Promise<unknown>,
  receive: () => Promise<T>,
): Promise<T> {
  await requireVerifiedContact();
  return receive();
}
