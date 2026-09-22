import { readConversationDescriptors, removeConversationDescriptor, saveConversationDescriptor, type ProductSecureStorage } from './sessionStore';

class MemoryStore implements ProductSecureStorage {
  private value?: ArrayBuffer;
  async read(): Promise<ArrayBuffer | undefined> { return this.value?.slice(0); }
  async write(_type: string, _id: string, value: ArrayBuffer): Promise<void> { this.value = value.slice(0); }
  corrupt(value: string): void { this.value = new TextEncoder().encode(value).buffer as ArrayBuffer; }
}

const descriptor = (roomId: string, updatedAt: number) => ({
  version: 1 as const,
  roomId,
  controlCapability: 'control-capability-value',
  remoteAddress: 'remote-address-value',
  label: 'Private contact',
  updatedAt,
});

describe('encrypted product session records', () => {
  it('restores ordered conversations and replaces an existing room without duplication', async () => {
    const store = new MemoryStore();
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000001', 1));
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000002', 2));
    await saveConversationDescriptor(store, { ...descriptor('00000000-0000-4000-8000-000000000001', 3), label: 'Updated' });
    const restored = await readConversationDescriptors(store);
    expect(restored.map((item) => item.label)).toEqual(['Updated', 'Private contact']);
  });

  it('rejects corrupted or security-incomplete saved state', async () => {
    const store = new MemoryStore();
    store.corrupt(JSON.stringify([{ version: 1, roomId: 'fake', controlCapability: '', label: '', updatedAt: -1 }]));
    await expect(readConversationDescriptors(store)).rejects.toThrow('invalid');
  });

  it('removes only the selected conversation', async () => {
    const store = new MemoryStore();
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000001', 1));
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000002', 2));
    const remaining = await removeConversationDescriptor(store, '00000000-0000-4000-8000-000000000002');
    expect(remaining.map((item) => item.roomId)).toEqual(['00000000-0000-4000-8000-000000000001']);
  });
});
