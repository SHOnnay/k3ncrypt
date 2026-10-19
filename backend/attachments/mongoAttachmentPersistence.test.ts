import { Binary, BSON, type Db } from 'mongodb';
import { MongoAttachmentPersistence } from './mongoAttachmentPersistence';

const make = (transform: (value: any) => any = value => BSON.deserialize(BSON.serialize(value))) => {
    const values: any[] = [];
    const collection = {
        insertOne: async (v: any) => { values.push(transform(v)); },
        findOne: async () => values[0],
        find: () => ({ sort: () => ({ toArray: async () => values }), toArray: async () => values }),
    };
    return { values, persistence: new MongoAttachmentPersistence({ collection: () => collection } as unknown as Db) };
};
const chunk = { attachmentId: 'synthetic', index: 0, total: 1, nonce: new Uint8Array([1, 2, 3]), ciphertext: new Uint8Array([4, 5, 6, 7]) };

test.each(['default Binary', 'promoted Buffer'])('%s round-trip preserves all chunk and metadata bytes with independent copies', async mode => {
    const { persistence, values } = make(value => BSON.deserialize(BSON.serialize(value), { promoteBuffers: mode === 'promoted Buffer' }));
    await persistence.chunks.insert(chunk);
    expect(await persistence.chunks.find('synthetic', 0)).toEqual(chunk);
    expect(await persistence.chunks.list('synthetic')).toEqual([chunk]);
    const decoded = (await persistence.chunks.find('synthetic', 0))!;
    decoded.ciphertext[0] = 99;
    expect((await persistence.chunks.find('synthetic', 0))!.ciphertext).toEqual(chunk.ciphertext);
    values.length = 0;
    const record: any = { id: 'synthetic', expiresAt: 1, status: 'complete', encryptedMetadata: { nonce: chunk.nonce, ciphertext: chunk.ciphertext } };
    await persistence.metadata.insert(record);
    const result = await persistence.metadata.find('synthetic');
    expect(result?.encryptedMetadata).toEqual(record.encryptedMetadata);
    expect((await persistence.metadata.expired(2))[0].encryptedMetadata).toEqual(record.encryptedMetadata);
});

test('Binary spare capacity is never returned as ciphertext', async () => {
    const { persistence, values } = make(value => value);
    await persistence.chunks.insert(chunk);
    const binary = new Binary(); binary.put(17); binary.put(23);
    expect(binary.buffer.byteLength).toBeGreaterThan(2);
    values[0].ciphertext = binary;
    expect((await persistence.chunks.find('synthetic', 0))!.ciphertext).toEqual(new Uint8Array([17, 23]));
});

test.each(['string', 'array', 'wrong-subtype', 'invalid-length'])('malformed %s fails closed without empty-byte substitution', async kind => {
    const { persistence, values } = make(value => value);
    await persistence.chunks.insert(chunk);
    const malformed = kind === 'string' ? 'secret-not-logged' : kind === 'array' ? [1, 2] : new Binary(Buffer.from([1]), kind === 'wrong-subtype' ? Binary.SUBTYPE_UUID : Binary.SUBTYPE_DEFAULT);
    if (kind === 'invalid-length') (malformed as Binary).position = 100;
    values[0].ciphertext = malformed;
    await expect(persistence.chunks.find('synthetic', 0)).rejects.toThrow('Attachment binary storage unavailable.');
});
