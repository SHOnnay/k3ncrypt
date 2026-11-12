import db from '../db';
import { OFFLINE_MESSAGE_COLLECTION } from '../db/const';
import { withdrawWakeRoute } from '../push/authenticatedWakeRoutes';
import getClientInstance from '../socket.io/clients';
import { relayServer } from '../socket.io';
import { legacyRoomOwner, muxRoomOwner, releaseMuxRoomOwner } from '../socket.io/multiplexed';

/**
 * Runs only after the routing owner of (room, address) has been durably revoked by its own device.
 * Drops what the relay still holds for that address: waiting mail, the push wake route and any live room socket.
 * Safe to repeat. The room and the other participant's route are left untouched.
 */
export const purgeRemovedRoute = async (channel: string, address: string): Promise<void> => {
  const database = db.getDatabase();
  if (database) {
    await database.collection(OFFLINE_MESSAGE_COLLECTION).deleteMany({ channel, mailbox: address });
    await withdrawWakeRoute(database, channel, address);
  }
  const mux = muxRoomOwner(channel, address);
  if (mux) releaseMuxRoomOwner(mux, channel);
  const server = relayServer();
  const legacy = server ? legacyRoomOwner(channel, address, server) : undefined;
  if (legacy) { getClientInstance().deleteClient(address, channel, legacy.id); legacy.disconnect(true); }
};
