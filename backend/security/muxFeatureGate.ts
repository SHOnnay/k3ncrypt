/** Production cannot opt in; nonproduction must opt in explicitly. */
export const muxRelayEnabled = (): boolean => process.env.NODE_ENV !== 'production' &&
  process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY === 'true';
