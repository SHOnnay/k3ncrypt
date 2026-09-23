import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, verify } from 'node:crypto';

const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'protocol-fixtures', 'v1', name), 'utf8')) as Record<string, unknown>;

describe('Phase 9 cross-platform protocol fixtures', () => {
  it('locks unpadded base64url and SHA-256 conventions', () => {
    const value = fixture('encoding.json').accepted as Record<string, string>;
    expect(createHash('sha256').update(value.utf8, 'utf8').digest('hex')).toBe(value.sha256Hex);
    expect(Buffer.from([1, 2, 3]).toString('base64url')).toBe(value.base64url);
  });

  it('contains a valid synthetic Ed25519 control signature and rejects a modified payload', () => {
    const value = fixture('control-signatures.json');
    const publicKey = Buffer.from(value.syntheticEd25519PublicKey as string, 'base64url');
    const accepted = value.accepted as Record<string, string>;
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const key = { key: Buffer.concat([spkiPrefix, publicKey]), format: 'der' as const, type: 'spki' as const };
    expect(verify(null, Buffer.from(accepted.canonicalPayload, 'utf8'), key, Buffer.from(accepted.signature, 'base64url'))).toBe(true);
    expect(verify(null, Buffer.from((value.modifiedField as Record<string, string>).canonicalPayload, 'utf8'), key, Buffer.from(accepted.signature, 'base64url'))).toBe(false);
  });

  it('keeps the modern encrypted envelope schema strict', () => {
    const value = fixture('encrypted-envelopes.json');
    const accepted = JSON.parse((value.accepted as Record<string, string>).serialized);
    expect(Object.keys(accepted)).toEqual(['version', 'strategy', 'data']);
    expect(accepted.version).toBe(2);
    expect(accepted.strategy).toBe('vodozemac-olm-v1');
    expect(Object.keys(accepted.data)).toEqual(['version', 'olmMessage']);
  });
});
