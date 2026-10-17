import { ComposerDrafts } from './composerDrafts';

describe('ComposerDrafts', () => {
  it('keeps each conversation draft separate so text cannot follow the user into another room', () => {
    const drafts = new ComposerDrafts();
    drafts.set('room-a', 'hello A');
    expect(drafts.get('room-b')).toBe('');
    drafts.set('room-b', 'hello B');
    expect(drafts.get('room-a')).toBe('hello A');
    expect(drafts.get('room-b')).toBe('hello B');
  });

  it('preserves the draft when sending fails and clears it only after the exact text was sent', () => {
    const drafts = new ComposerDrafts();
    drafts.set('room-a', 'first');
    // Failed send: nothing is cleared.
    expect(drafts.get('room-a')).toBe('first');
    // User kept typing while the send was in flight: the newer text must survive a successful send.
    drafts.set('room-a', 'first and more');
    expect(drafts.clearIfUnchanged('room-a', 'first')).toBe(false);
    expect(drafts.get('room-a')).toBe('first and more');
    expect(drafts.clearIfUnchanged('room-a', 'first and more')).toBe(true);
    expect(drafts.get('room-a')).toBe('');
  });

  it('drops whitespace-only drafts, ignores a missing room and bounds memory', () => {
    const drafts = new ComposerDrafts();
    drafts.set('room-a', '   ');
    expect(drafts.get('room-a')).toBe('');
    drafts.set(undefined, 'orphan');
    expect(drafts.get(undefined)).toBe('');
    for (let i = 0; i < 80; i += 1) drafts.set(`room-${i}`, `draft ${i}`);
    expect(drafts.get('room-0')).toBe('');
    expect(drafts.get('room-79')).toBe('draft 79');
  });

  it('never persists drafts to browser storage', () => {
    const touched: string[] = [];
    const storage = { setItem: () => touched.push('set'), getItem: () => null, removeItem: () => undefined };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    new ComposerDrafts().set('room-a', 'secret');
    expect(touched).toEqual([]);
  });
});

it('clears plaintext on lock/identity change and rejects an old session completion', () => {
  const drafts = new ComposerDrafts(); const first = {}; const next = {};
  drafts.bind(first); drafts.set('a', 'private');
  expect(drafts.boundTo(first)).toBe(true);
  drafts.bind(undefined); expect(drafts.get('a')).toBe('');
  drafts.bind(next); drafts.set('a', 'new identity');
  expect(drafts.boundTo(first)).toBe(false);
  expect(drafts.get('a')).toBe('new identity');
});

it('keeps a per-room send fence across remounts and rejects stale completion after identity change', () => {
  const drafts=new ComposerDrafts(),scope={};drafts.bind(scope);
  const ticket=drafts.beginSend('a',scope)!;expect(drafts.isSending('a')).toBe(true);
  expect(drafts.beginSend('a',scope)).toBeUndefined();expect(drafts.beginSend('b',scope)).toBeDefined();
  drafts.endSend('a',ticket,scope);expect(drafts.isSending('a')).toBe(false);
  drafts.bind({});drafts.endSend('b',ticket,scope);expect(drafts.isSending('b')).toBe(false);
});
