import type { SecureRecordUpdate } from '../../../service/src/core/contracts';
import type { ProductSecureStorage } from './sessionStore';

/** Test adapter with atomic, copy-isolated CAS (no await between compare and commit). */
export class TestProductStorage implements ProductSecureStorage {
  readonly records = new Map<string, ArrayBuffer>();
  read = async (type: string, id: string): Promise<ArrayBuffer | undefined> => this.records.get(type + ':' + id)?.slice(0);
  write = async (type: string, id: string, value: ArrayBuffer): Promise<void> => { this.records.set(type + ':' + id, value.slice(0)); };
  put = (type: string, id: string, value: unknown): Promise<void> => this.write(type, id, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer);
  async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
    if (updates.some(item => {
      const before = this.records.get(item.recordType + ':' + item.recordId);
      return (before === undefined) !== (item.expected === undefined) || before && item.expected && (before.byteLength !== item.expected.byteLength || !new Uint8Array(before).every((byte, index) => byte === new Uint8Array(item.expected!)[index]));
    })) return false;
    for (const item of updates) this.records.set(item.recordType + ':' + item.recordId, item.next.slice(0));
    return true;
  }
}
