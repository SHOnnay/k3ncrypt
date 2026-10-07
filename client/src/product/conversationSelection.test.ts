import { ConversationSelection } from './conversationSelection';
it('failed candidate leaves the current session, trust and messages intact and still able to send', async () => {
  const selections = new ConversationSelection(); const previous = { closed: false, messages: ['kept'], verified: true, send: jest.fn() }; let current = previous;
  const commit = jest.fn(async (candidate: typeof previous) => { previous.closed = true; current = candidate; });
  await expect(selections.run(async () => { throw new Error('Candidate failed'); }, commit)).rejects.toThrow('Candidate failed');
  expect(commit).not.toHaveBeenCalled(); expect(current).toBe(previous); expect(previous.closed).toBe(false); expect(previous.messages).toEqual(['kept']); expect(previous.verified).toBe(true);
  current.send('still usable'); expect(previous.send).toHaveBeenCalledWith('still usable');
  const next = { ...previous, messages: ['next'] }; await selections.run(async () => next, commit); expect(current).toBe(next);
});
