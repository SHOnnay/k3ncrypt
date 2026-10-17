import { detachVerifiedOutput, previewableImageType } from './verifiedOutput';

const saved = (bytes: number[], mimeType: string | undefined, dispose = jest.fn(async () => undefined)) => ({
  file: new File([new Uint8Array(bytes)], 'x', { type: mimeType }), filename: 'photo.png', mimeType, dispose,
});

describe('detachVerifiedOutput', () => {
  it('copies verified bytes into memory and releases the disk slot', async () => {
    const source = saved([1, 2, 3], 'image/png');
    const out = await detachVerifiedOutput(source);
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(out.filename).toBe('photo.png');
    expect(out.blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await out.blob.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('never trusts a sender-supplied type for anything but a safe image preview', async () => {
    expect((await detachVerifiedOutput(saved([1], 'text/html'))).blob.type).toBe('application/octet-stream');
    expect((await detachVerifiedOutput(saved([1], 'image/svg+xml'))).blob.type).toBe('application/octet-stream');
    expect(previewableImageType('image/jpeg')).toBe('image/jpeg');
    expect(previewableImageType(undefined)).toBeUndefined();
  });

  it('still releases the disk slot when reading fails', async () => {
    const source = saved([1], 'image/png');
    Object.defineProperty(source.file, 'arrayBuffer', { value: async () => { throw new Error('read failed'); } });
    await expect(detachVerifiedOutput(source)).rejects.toThrow('read failed');
    expect(source.dispose).toHaveBeenCalledTimes(1);
  });
});
