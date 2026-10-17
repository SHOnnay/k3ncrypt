import { decideScroll, isNearBottom, messageKeys } from './messageList';

describe('message list keys', () => {
  it('follows the message, not its position, so per-message state cannot move to another message', () => {
    const before = messageKeys([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const afterRemoval = messageKeys([{ id: 'a' }, { id: 'c' }, { id: 'b-retry' }]);
    expect(before).toEqual(['["","a",0]', '["","b",0]', '["","c",0]']);
    expect(afterRemoval[1]).toBe(before[2]);
  });

  it('separates identical IDs across rooms', () => {
    expect(messageKeys([{ id: 'x' }], 'a')).not.toEqual(messageKeys([{ id: 'x' }], 'b'));
  });

  it('keeps keys unique when ids repeat or are empty', () => {
    const keys = messageKeys([{ id: 'x' }, { id: 'x' }, { id: 'x#1' }, { id: '' }]);
    expect(new Set(keys).size).toBe(4);
  });
});

describe('scroll decision', () => {
  const base = { roomChanged: false, previousLastId: 'm1', lastId: 'm2', lastIsOwn: false, nearBottom: true };
  it('jumps instantly when a conversation is opened instead of animating through history', () => {
    expect(decideScroll({ ...base, roomChanged: true })).toBe('instant');
  });
  it('follows new messages only when the reader is at the bottom or sent them', () => {
    expect(decideScroll(base)).toBe('smooth');
    expect(decideScroll({ ...base, nearBottom: false })).toBe('none');
    expect(decideScroll({ ...base, nearBottom: false, lastIsOwn: true })).toBe('smooth');
  });
  it('does not scroll for delivery-status updates that change no message', () => {
    expect(decideScroll({ ...base, previousLastId: 'm2' })).toBe('none');
    expect(decideScroll({ ...base, lastId: undefined })).toBe('none');
  });
  it('jumps instantly when saved history first fills an already-open empty conversation', () => {
    expect(decideScroll({ ...base, previousLastId: undefined })).toBe('instant');
  });
  it('treats the last 120px as near the bottom', () => {
    expect(isNearBottom(1000, 800, 100)).toBe(true);
    expect(isNearBottom(1000, 500, 100)).toBe(false);
  });
});
