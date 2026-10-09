import { muxClientEnabled, type MuxClientFeatureEnvironment } from './muxFeatureGate';

const env = (overrides: MuxClientFeatureEnvironment): MuxClientFeatureEnvironment => overrides;

it.each([
  [{ DEV: true, VITE_K3NCRYPT_MUX_STAGE1: 'true' }, true],
  [{ DEV: true, PROD: true, VITE_K3NCRYPT_MUX_STAGE1: 'true' }, false],
  [{ DEV: true, PROD: true, VITE_K3NCRYPT_MUX_STAGE1: 'true', VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN: 'true' }, false],
  [{ DEV: true, VITE_K3NCRYPT_MUX_STAGE1: 'false' }, false],
  [{ DEV: true }, false],
  [{ DEV: true, VITE_K3NCRYPT_MUX_STAGE1: 'TRUE' }, false],
  [{ PROD: true, VITE_K3NCRYPT_MUX_STAGE1: 'true', VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN: 'true' }, true],
  [{ PROD: true, VITE_K3NCRYPT_MUX_STAGE1: 'true' }, false],
  [{ PROD: true, VITE_K3NCRYPT_MUX_STAGE1: 'true', VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN: 'false' }, false],
  [{ PROD: true, VITE_K3NCRYPT_MUX_STAGE1: 'true', VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN: 'TRUE' }, false],
  [{ PROD: true, VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN: 'true' }, false],
  [{ VITE_K3NCRYPT_MUX_STAGE1: 'true', VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN: 'true' }, false],
  [undefined, false],
])('evaluates client Mux configuration fail-closed: %j', (configuration, expected) => {
  expect(muxClientEnabled(configuration ? env(configuration) : undefined)).toBe(expected);
});
