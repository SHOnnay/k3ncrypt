/** Test and diagnostics hooks are inert in production, even if a page sets a global flag. */
export const testDiagnosticsEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' &&
  (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ === true;
