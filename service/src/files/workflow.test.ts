import { randomUUID, webcrypto } from 'crypto';
import { FileTransferWorkflow, type FileGateway, type FileOutput, type SealedFileCache } from './workflow';
import { FILE_LIMITS as L, parseFileReference, serializeFileReference, type FileBinding, type FileStatus, type WireObject } from './protocol';
import { FileTransferState } from './state';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const fp = (c: string): string => 'K3 ' + Array(10).fill(c.repeat(4)).join(' ') + ' ' + c.repeat(3);
const binding: FileBinding = { conversationId: randomUUID(), senderParticipantId: randomUUID(), recipientParticipantId: randomUUID(), senderIdentityReference: fp('A'), recipientIdentityReference: fp('B') };
const recipient: FileBinding = { conversationId: binding.conversationId, senderParticipantId: binding.recipientParticipantId, recipientParticipantId: binding.senderParticipantId, senderIdentityReference: binding.recipientIdentityReference, recipientIdentityReference: binding.senderIdentityReference };
class Gateway implements FileGateway {
    file!: FileStatus; objects = new Map<number, WireObject>(); uploads: number[] = []; failAfterAccept = false; gate?: Promise<void>; tamper = false; cancelCount = 0;
    async create(b: FileBinding, size: number): Promise<FileStatus> { const createdAt = Date.now(); this.file = { version: 2, context: { ...b, transferId: randomUUID(), fileSize: size, chunkSize: L.MAX_CHUNK_SIZE, chunkCount: Math.ceil(size / L.MAX_CHUNK_SIZE) }, createdAt, expiresAt: createdAt + L.TRANSFER_EXPIRY, state: 'incomplete', indices: [] }; return structuredClone(this.file); }
    async status(): Promise<FileStatus> { return structuredClone(this.file); }
    async put(_id: string, index: 'manifest' | number, v: WireObject): Promise<FileStatus> { if (index === 'manifest') this.file.manifest = v; else { this.uploads.push(index); this.objects.set(index, v); if (!this.file.indices.includes(index)) this.file.indices.push(index); if (this.failAfterAccept) { this.failAfterAccept = false; throw new Error('Network unavailable.'); } } await this.gate; return this.status(); }
    async complete(): Promise<FileStatus> { this.file.state = 'available'; return this.status(); }
    async chunk(_id: string, index: number): Promise<WireObject> { await this.gate; const value = { ...this.objects.get(index)! }; if (this.tamper) value.ciphertext = (value.ciphertext[0] === 'A' ? 'B' : 'A') + value.ciphertext.slice(1); return value; }
    async cancel(): Promise<void> { this.cancelCount++; this.file.state = 'canceled'; }
}
const cache = (): SealedFileCache => { const values = new Map<string, WireObject>(); return { get: async i => values.get(i), put: async (i, v) => { values.set(i, structuredClone(v)); }, clear: async () => { values.clear(); } }; };
const source = (size = L.MAX_CHUNK_SIZE + 7) => ({ size, name: '../risky.svg', type: 'text/html<script>', read: jest.fn(async (offset: number, count: number) => Uint8Array.from({ length: count }, (_, i) => (offset + i) % 251)) });
const output = () => { const pieces: Uint8Array[] = []; let finished = false; let discarded = false; const out: FileOutput<{ name: string; bytes: number }> = { write: async v => { pieces.push(new Uint8Array(v)); }, finish: async m => { finished = true; return { name: m.filename, bytes: pieces.reduce((s, v) => s + v.length, 0) }; }, discard: async () => { discarded = true; pieces.length = 0; } }; return { out, pieces, finished: () => finished, discarded: () => discarded }; };
test('new send is V2 only, bounded source reads, recipient authenticates output before completion', async () => {
    const gateway = new Gateway(); let reference = ''; const src = source();
    const sender = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async r => { reference = r; });
    await sender.send(src); expect(sender.state.value.phase).toBe('WaitingForRecipient'); expect(gateway.uploads).toEqual([0, 1]); expect(src.read.mock.calls.map(v => v[1])).toEqual([L.MAX_CHUNK_SIZE, 7]);
    expect(parseFileReference(reference).version).toBe(2); expect(reference.startsWith('k3ncrypt-media-v1:')).toBe(false);
    const receiver = new FileTransferWorkflow(gateway, async () => recipient, async () => cache(), async () => {}); const target = output();
    await expect(receiver.receive(reference, async () => target.out)).resolves.toEqual({ name: '_risky.svg', bytes: src.size });
    expect(receiver.state.value.phase).toBe('Complete'); expect(target.finished()).toBe(true);
});
test('lost acknowledgement reconciles server truth and uploads only missing sealed objects', async () => {
    const gateway = new Gateway(); gateway.failAfterAccept = true; const src = source();
    const sender = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async () => {});
    await sender.send(src); expect(sender.state.value).toMatchObject({ phase: 'Failed', retryable: true });
    const accepted = structuredClone(gateway.objects.get(0)); await sender.retry();
    expect(sender.state.value.phase).toBe('WaitingForRecipient'); expect(gateway.uploads).toEqual([0, 1]); expect(gateway.objects.get(0)).toEqual(accepted); expect(src.read).toHaveBeenCalledTimes(2);
});
test('unverified/identity replacement authority fails closed before create or publication', async () => {
    const gateway = new Gateway(); const s = new FileTransferWorkflow(gateway, async () => { throw new Error('Verified unchanged contact required.'); }, async () => cache(), async () => {});
    await s.send(source(1)); expect(gateway.file).toBeUndefined(); expect(s.state.value.phase).toBe('Failed');
    let calls = 0; const publish = jest.fn(); const changed = new FileTransferWorkflow(gateway, async () => ++calls > 1 ? { ...binding, recipientIdentityReference: fp('M') } : binding, async () => cache(), publish);
    await changed.send(source(1)); expect(changed.state.value.phase).toBe('Failed'); expect(publish).not.toHaveBeenCalled();
});
test('version stripping, unsupported version and identity substitution never reach output', async () => {
    const gateway = new Gateway(); let reference = ''; const s = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async r => { reference = r; }); await s.send(source(1));
    const r = parseFileReference(reference);
    for (const version of [undefined, 1, 3]) expect(() => serializeFileReference({ ...r, version } as typeof r)).toThrow();
    const substituted = serializeFileReference({ ...r, context: { ...r.context, recipientIdentityReference: fp('M') } }); const createOutput = jest.fn();
    const recv = new FileTransferWorkflow(gateway, async () => recipient, async () => cache(), async () => {}); await recv.receive(substituted, createOutput); expect(createOutput).not.toHaveBeenCalled();
});
test('tamper/missing chunk never exposes final output; partial plaintext discarded', async () => {
    const gateway = new Gateway(); let reference = ''; const s = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async r => { reference = r; }); await s.send(source());
    gateway.tamper = true; const target = output(); const recv = new FileTransferWorkflow(gateway, async () => recipient, async () => cache(), async () => {});
    expect(await recv.receive(reference, async () => target.out)).toBeUndefined(); expect(target.finished()).toBe(false); expect(target.discarded()).toBe(true);
    gateway.tamper = false; gateway.file.indices = [0]; const factory = jest.fn(); await recv.receive(reference, factory); expect(factory).not.toHaveBeenCalled();
});
test('cancel mid upload and stale acknowledgement cannot resurrect terminal state; repeated cancel safe', async () => {
    const gateway = new Gateway(); let release!: () => void; gateway.gate = new Promise<void>(resolve => { release = resolve; }); const publish = jest.fn();
    const s = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), publish); const send = s.send(source());
    while (!gateway.file?.manifest) await new Promise(resolve => setTimeout(resolve, 1)); s.cancel(); s.cancel(); release(); await send;
    expect(s.state.value.phase).toBe('Canceled'); expect(publish).not.toHaveBeenCalled(); expect(gateway.objects.size).toBe(0);
});
test('cancel mid download discards output and stale chunk completion cannot claim complete', async () => {
    const gateway = new Gateway(); let reference = ''; const s = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async r => { reference = r; }); await s.send(source());
    let release!: () => void; gateway.gate = new Promise<void>(resolve => { release = resolve; }); const target = output();
    const recv = new FileTransferWorkflow(gateway, async () => recipient, async () => cache(), async () => {}); const promise = recv.receive(reference, async () => target.out);
    while (recv.state.value.phase !== 'Downloading') await new Promise(resolve => setTimeout(resolve, 1)); await new Promise(resolve => setTimeout(resolve, 2)); recv.cancel(); release(); await promise;
    expect(recv.state.value.phase).toBe('Canceled'); expect(target.finished()).toBe(false); expect(target.discarded()).toBe(true);
});
test('full output storage fails once and does not retry forever; new process does not pretend sender can resume', async () => {
    const gateway = new Gateway(); let reference = ''; const s = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async r => { reference = r; }); await s.send(source(1));
    const recv = new FileTransferWorkflow(gateway, async () => recipient, async () => cache(), async () => {}); const factory = jest.fn(async () => { throw new Error('Not enough local storage space.'); }); await recv.receive(reference, factory); expect(factory).toHaveBeenCalledTimes(1); expect(recv.state.value.failure).toBe('Not enough local storage.');
    const restarted = new FileTransferWorkflow(gateway, async () => binding, async () => cache(), async () => {}); await restarted.retry(); expect(restarted.state.value.phase).toBe('RestartRequired');
});
test('typed state transitions reject terminal resurrection and obsolete generations', () => {
    const s = new FileTransferState(); const g = s.begin(1); expect(s.move(g, 'Complete')).toBe(false); s.cancel(); expect(s.move(g, 'Uploading')).toBe(false); const next = s.begin(1); expect(s.move(g, 'Encrypting')).toBe(false); s.move(next, 'Failed'); expect(s.move(next, 'Encrypting')).toBe(false);
});
