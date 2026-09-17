import { randomUUID } from 'crypto';

const { CHAT_LINK_DOMAIN } = process.env;

export type LinkType = {
  hash: string,
  expired: boolean,
  deleted: boolean,
  controlCapabilityHash: string,
}

/**
 * Generates a new public room id.
 *
 * There is no PIN any more: joining requires the invitation fragment
 * The invitation fragment carries independent 256-bit message and room
 * control secrets generated on the client. This record stores only the
 * control capability's SHA-256 verifier; a short PIN would be insufficient.
 */
const generateHash = (controlCapabilityHash: string): LinkType => {
  const hash = randomUUID();

  if (!CHAT_LINK_DOMAIN) {
    console.warn('CHAT_LINK_DOMAIN not found in env');
  }

  return {
    hash,
    expired: false,
    deleted: false,
    controlCapabilityHash,
  };
};

export default generateHash;
