export interface MuxClientFeatureEnvironment {
  DEV?: boolean;
  PROD?: boolean;
  VITE_K3NCRYPT_MUX_STAGE1?: string;
  VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN?: string;
}

/** Development keeps the existing explicit gate; production requires a second exact opt-in. */
export const muxClientEnabled = (env: MuxClientFeatureEnvironment | undefined): boolean => {
  if (!env || env.VITE_K3NCRYPT_MUX_STAGE1 !== 'true') return false;
  if (env.DEV === true && env.PROD === true) return false;
  if (env.PROD === true) return env.VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN === 'true';
  return env.DEV === true;
};
