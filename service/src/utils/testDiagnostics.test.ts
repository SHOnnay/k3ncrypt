import { testDiagnosticsEnabled } from './testDiagnostics';

describe('test-only diagnostics gate', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = originalFlag;
  });

  it('allows an explicit diagnostics flag in non-production only', () => {
    process.env.NODE_ENV = 'test';
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
    expect(testDiagnosticsEnabled()).toBe(true);
  });

  it('cannot be enabled by setting the page global in production', () => {
    process.env.NODE_ENV = 'production';
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
    expect(testDiagnosticsEnabled()).toBe(false);
  });
});
