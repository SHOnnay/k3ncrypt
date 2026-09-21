import { deviceListCommitment } from '../devices/canonicalEncoding';
import type { DeviceList } from '../devices/deviceIdentity';
import type { SyncPackage } from './contracts';

const PREFIX = 'k3ncrypt-sync-v1:';
const HEX = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{16,128}$/;
const encoder = new TextEncoder();

const canonical = (value: unknown): string => JSON.stringify(value);
const digest = async (bytes: Uint8Array): Promise<string> => {
    if (!globalThis.crypto?.subtle) throw new Error('Sync integrity is unavailable.');
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const syncDigest = async (value: unknown): Promise<string> => digest(encoder.encode(canonical(value)));

export const verifySyncDigest = async (value: SyncPackage, expected: string): Promise<boolean> => /^[0-9a-f]{64}$/.test(expected) && (await syncDigest(value)) === expected;

export const encodeSyncPackage = (value: SyncPackage): ArrayBuffer => encoder.encode(`${PREFIX}${canonical(value)}`).buffer as ArrayBuffer;

export const decodeSyncPackage = (bytes: ArrayBuffer): SyncPackage => {
    if (bytes.byteLength > 65536) throw new Error('Sync package is too large.');
    const text = new TextDecoder().decode(bytes);
    if (!text.startsWith(PREFIX)) throw new Error('Invalid sync package.');
    let parsed: unknown;
    try { parsed = JSON.parse(text.slice(PREFIX.length)); } catch { throw new Error('Invalid sync package.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid sync package.');
    const value = parsed as Record<string, unknown>;
    const allowed = ['version','purpose','scope','sender','senderIdentity','receiver','receiverIdentity','checkpoint','streamId','sequence','messageId','transferId','payload'];
    if (Object.keys(value).some((key) => !allowed.includes(key)) || value.version !== 1 || typeof value.scope !== 'string' || typeof value.sender !== 'string' || typeof value.receiver !== 'string' || typeof value.senderIdentity !== 'string' || typeof value.receiverIdentity !== 'string' || typeof value.streamId !== 'string' || typeof value.messageId !== 'string' || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || !value.checkpoint || typeof value.checkpoint !== 'object') throw new Error('Invalid sync package.');
    if (!ID.test(value.streamId as string) || !ID.test(value.messageId as string) || (value.transferId !== undefined && (typeof value.transferId !== 'string' || !ID.test(value.transferId)))) throw new Error('Invalid sync package.');
    const checkpoint = value.checkpoint as Record<string, unknown>;
    if (!Number.isSafeInteger(checkpoint.epoch) || (checkpoint.epoch as number) < 0 || typeof checkpoint.commitment !== 'string' || !HEX.test(checkpoint.commitment as string)) throw new Error('Invalid sync checkpoint.');
    if (!['sync-manifest','sync-chunk','sync-delta','sync-ack','sync-reconcile'].includes(value.purpose as string)) throw new Error('Invalid sync purpose.');
    return Object.freeze({ ...value, checkpoint: Object.freeze({ epoch: checkpoint.epoch as number, commitment: checkpoint.commitment }) }) as unknown as SyncPackage;
};

export const verifyDeviceListCheckpoint = async (list: DeviceList, checkpoint: { epoch: number; commitment: string }): Promise<void> => {
    if (list.epoch !== checkpoint.epoch || await deviceListCommitment(list) !== checkpoint.commitment) throw new Error('Sync checkpoint mismatch.');
};
