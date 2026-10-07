import { createRoomState, updateRoomState } from './roomState';

it('keeps room messages, session, and connection state isolated by immutable room key', () => {
  const aliceBob = { ...createRoomState('room-bob'), messages: [{ id: 'b1' }] as never[], connection: 'connected' as const };
  const states = updateRoomState({ 'room-bob': aliceBob }, 'room-carol', { messages: [{ id: 'c1' }] as never[], connection: 'connecting' });
  expect(states['room-bob']).toBe(aliceBob);
  expect(states['room-carol']).toMatchObject({ roomId: 'room-carol', messages: [{ id: 'c1' }], connection: 'connecting' });
  expect(states['room-carol'].conversation).toBeUndefined();
});
