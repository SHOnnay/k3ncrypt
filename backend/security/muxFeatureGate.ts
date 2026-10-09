/** Mux is opt-in in nonproduction and requires two exact opt-ins in production. */
export const muxRelayEnabled = (): boolean => {
  if (process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY !== 'true') return false;
  if (process.env.NODE_ENV === 'production') return process.env.K3NCRYPT_MUX_PRODUCTION_OPT_IN === 'true';
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
};
