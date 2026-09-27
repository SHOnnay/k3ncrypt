import { readProfileName, writeProfileName } from './profileStore';
import type { ProductSecureStorage } from './sessionStore';

class ProfileMemoryStore implements ProductSecureStorage {
  private value?: ArrayBuffer;
  async read(): Promise<ArrayBuffer | undefined> { return this.value?.slice(0); }
  async write(_type: string, _id: string, value: ArrayBuffer): Promise<void> { this.value = value.slice(0); }
}

describe('local profile display name', () => {
  it('stores and restores a normalized local name', async () => {
    const storage = new ProfileMemoryStore();
    expect(await readProfileName(storage)).toBeUndefined();
    await expect(writeProfileName(storage, '  Rahim   Khan  ')).resolves.toBe('Rahim Khan');
    await expect(readProfileName(storage)).resolves.toBe('Rahim Khan');
  });

  it('rejects blank, oversized, and control-character names', async () => {
    const storage = new ProfileMemoryStore();
    await expect(writeProfileName(storage, '   ')).rejects.toThrow('1–40');
    await expect(writeProfileName(storage, 'x'.repeat(41))).rejects.toThrow('1–40');
    await expect(writeProfileName(storage, 'Rahim\nKhan')).rejects.toThrow('1–40');
  });
});
