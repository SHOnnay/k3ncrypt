import { PreviewResources, FileOperationGate } from './previewResources';
import { detachVerifiedOutput } from './verifiedOutput';

it('retains two sequential unsaved previews including a canceled Save, then releases each exactly once', () => {
  let id = 0; const revoke = jest.fn(); const resources = new PreviewResources(() => `blob:${++id}`, revoke);
  const first = resources.add('room:a', new Blob(['one']));
  const second = resources.add('room:b', new Blob(['two']));
  // Browser Save has no receipt/cancellation API: it must not dispose either link.
  expect(first).not.toBe(second); expect(revoke).not.toHaveBeenCalled();
  resources.release('room:a'); resources.release('room:a'); resources.clear();
  expect(revoke.mock.calls).toEqual([['blob:1'], ['blob:2']]);
});
it('bounds retained plaintext without silently revoking another unsaved file', () => {
  const revoke = jest.fn(); const resources = new PreviewResources(() => 'blob:test', revoke);
  for (const key of ['a','b','c']) resources.add(key, new Blob(['x']));
  expect(() => resources.add('d', new Blob(['x']))).toThrow('Close an open preview');
  expect(revoke).not.toHaveBeenCalled(); resources.clear(); expect(revoke).toHaveBeenCalledTimes(3);
});
it('serializes concurrent acquisition and ignores stale release after cancellation', () => {
  const gate = new FileOperationGate(); const a = gate.acquire()!;
  expect(gate.acquire()).toBeUndefined(); gate.release(a);
  const b = gate.acquire()!; gate.release(a); expect(gate.acquire()).toBeUndefined();
  gate.release(b); expect(gate.acquire()).toBeDefined();
});
it('zeroes the transient copy while preserving the independent verified Blob', async () => {
  const bytes = new Uint8Array([1,2,3]); const dispose = jest.fn(async () => undefined);
  const file = { arrayBuffer: async () => bytes.buffer } as File;
  const out = await detachVerifiedOutput({file, filename:'test', dispose});
  expect([...bytes]).toEqual([0,0,0]);
  expect([...new Uint8Array(await out.blob.arrayBuffer())]).toEqual([1,2,3]);
  expect(dispose).toHaveBeenCalledTimes(1);
});
