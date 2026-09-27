type UserSidTypes = Record<'sid', string>;
type UserRecordType = Record<string, UserSidTypes>;
type ClientRecordType = Record<string, UserRecordType>;

/*
const clientRecord: ClientRecordType = {
    channelID: {
        userID1: {
            sid: <sid>
        },
        userID2: {
            sid: <sid>
        }
    }
};
*/
export interface ClientRecordInterface {
  getClients(): ClientRecordType,
  getClientsByChannel(channelID: string): UserRecordType,
  getSIDByIDs(userID: string, channelID: string): UserSidTypes,
  wouldExceedChannelCapacity(userID: string, channelID: string, capacity: number): boolean,
  setClientToChannel(userID: string, channelID: string, sid: string): void,
  deleteClient(userID: string, channelID: string, expectedSid: string): boolean,
}

class Clients implements ClientRecordInterface{
  private clientRecord: ClientRecordType = {}

  getClients(): ClientRecordType { return this.clientRecord }

  getClientsByChannel(channelID: string): UserRecordType {
    if (!channelID) {
      throw new Error("channelID - required param");
    }
    return this.clientRecord[channelID] || {};
  }

  getReceiverIDBySenderID(sender: string, channelID: string): string {
    const usersInChannel = this.getClientsByChannel(channelID);
    const usersInChannelArr = Object.keys(usersInChannel);

    const receiver = usersInChannelArr.find((u) => u !== sender);
    return receiver;
  }

  getSIDByIDs(userID: string, channelID: string): UserSidTypes {
    if (!(channelID && userID)) {
      throw new Error("channelID, userID - required param");
    }

    if(!this.clientRecord[channelID]) {
      return null;
    }
    const users = Object.keys(this.clientRecord[channelID]);

    const user = users.find((u) => u === userID);
    return this.clientRecord[channelID][user];
  }

  wouldExceedChannelCapacity(userID: string, channelID: string, capacity: number): boolean {
    if (!userID || !channelID || !Number.isInteger(capacity) || capacity < 1) return true;
    return Object.keys(this.getClientsByChannel(channelID)).length >= capacity && !this.getSIDByIDs(userID, channelID);
  }

  setClientToChannel(userID: string, channelID: string, sid: string): void {
    if (this.clientRecord[channelID]) {
      this.clientRecord[channelID][userID] = { sid };
    } else {
      this.clientRecord[channelID] = {
        [userID]: { sid }
      };
    }
  }

  deleteClient(userID: string, channelID: string, expectedSid: string): boolean {
    const current = this.clientRecord[channelID]?.[userID];
    // A delayed disconnect from an old socket must not erase a newer
    // connection that has already replaced it in this user/channel slot.
    if (!current || current.sid !== expectedSid) return false;
    delete this.clientRecord[channelID][userID];
    if (Object.keys(this.clientRecord[channelID]).length === 0) delete this.clientRecord[channelID];
    return true;
  }

  isSenderInChannel(channel: string, sender: string): boolean {
    const usersInChannel = this.getClientsByChannel(channel);
    const usersInChannelArr = Object.keys(usersInChannel);
    return !!usersInChannelArr.find((u) => u === sender);
  }

}

const clientInstance = new Clients();
const getClientInstance = () => clientInstance;

export default getClientInstance;
