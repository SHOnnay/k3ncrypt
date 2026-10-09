import type { Message } from '../types';

export type RoomConnectionState = 'saved' | 'connecting' | 'connected' | 'pending' | 'failed';

/** Room-owned state. UI selection points at this record; it does not own it. */
export interface RoomState<Conversation = unknown> {
  readonly roomId: string;
  readonly conversation?: Conversation;
  readonly messages: Message[];
  readonly connection: RoomConnectionState;
  readonly contactIdentity?: { readonly identityId: string };
  readonly fileReferences: readonly string[];
  readonly unread?: { readonly count: number; readonly throughEventId?: string };
  readonly call?: { readonly roomId: string; readonly callId: string; readonly peerIdentityReference?: string; readonly sessionBinding: string };
}

export const createRoomState = <Conversation = unknown>(roomId: string): RoomState<Conversation> => ({
  roomId,
  messages: [],
  connection: 'saved',
  fileReferences: [],
});

export const updateRoomState = <Conversation>(
  states: Readonly<Record<string, RoomState<Conversation>>>,
  roomId: string,
  update: Partial<Omit<RoomState<Conversation>, 'roomId'>>,
): Record<string, RoomState<Conversation>> => ({
  ...states,
  [roomId]: { ...(states[roomId] ?? createRoomState(roomId)), ...update, roomId },
});
