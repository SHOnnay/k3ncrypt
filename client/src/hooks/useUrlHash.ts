/**
 * Custom hook for invite-fragment URL management
 * (`#room=<public-room-id>&secret=<secret>&control=<capability>`).
 */

import { useEffect, useState } from 'react';
import { getUrlInvite, updateUrlInvite, hasValidInvite, type ParsedInvite } from '../utils/urlHash';

export const useUrlHash = () => {
  const [invite, setInvite] = useState<ParsedInvite | null>(null);

  useEffect(() => {
    if (hasValidInvite()) {
      setInvite(getUrlInvite());
    }
  }, []);

  const updateInvite = (roomId: string, secret: string, controlCapability: string) => {
    setInvite({ roomId, secret, controlCapability });
    updateUrlInvite(roomId, secret, controlCapability);
  };

  return {
    invite,
    setInvite,
    updateInvite,
    hasValidInvite: hasValidInvite(),
  };
};
