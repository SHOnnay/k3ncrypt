import { ConversationSelection, commitPreparedSelection } from './conversationSelection';
it('failed candidate leaves the current session, trust and messages intact and still able to send', async () => {
  const selections = new ConversationSelection(); const previous = { closed: false, messages: ['kept'], verified: true, send: jest.fn() }; let current = previous;
  const commit = jest.fn(async (candidate: typeof previous) => { previous.closed = true; current = candidate; });
  await expect(selections.run(async () => { throw new Error('Candidate failed'); }, commit)).rejects.toThrow('Candidate failed');
  expect(commit).not.toHaveBeenCalled(); expect(current).toBe(previous); expect(previous.closed).toBe(false); expect(previous.messages).toEqual(['kept']); expect(previous.verified).toBe(true);
  current.send('still usable'); expect(previous.send).toHaveBeenCalledWith('still usable');
  const next = { ...previous, messages: ['next'] }; await selections.run(async () => next, commit); expect(current).toBe(next);
});

it('does not partially activate warm room B when C supersedes a delayed history read', async () => {
  let generation=1;let release!:()=>void;
  const previous={room:'a',messages:['a'],identity:'a'};let visible=previous;
  const commit=jest.fn(value=>{visible=value;});
  const pending=commitPreparedSelection(async()=>{
    await new Promise<void>(resolve=>{release=resolve;});return {room:'b',messages:['b'],identity:'b'};
  },()=>generation===1,commit);
  generation=2;release();await expect(pending).rejects.toThrow('superseded');
  expect(commit).not.toHaveBeenCalled();expect(visible).toBe(previous);
});
it('projects a current prepared room atomically and leaves the selection intact if preparation fails', async () => {
  const commit=jest.fn();const room={room:'b',messages:['b'],identity:'b'};
  await expect(commitPreparedSelection(async()=>room,()=>true,commit)).resolves.toBe(room);
  expect(commit).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledWith(room);
  await expect(commitPreparedSelection(async()=>{throw new Error('read failed');},()=>true,commit)).rejects.toThrow('read failed');
  expect(commit).toHaveBeenCalledTimes(1);
});
it('rejects changed vault/session/room bindings before projecting prepared data', async () => {
  const commit=jest.fn();await expect(commitPreparedSelection(async()=>({room:'b'}),()=>false,commit)).rejects.toThrow('superseded');
  expect(commit).not.toHaveBeenCalled();
});
