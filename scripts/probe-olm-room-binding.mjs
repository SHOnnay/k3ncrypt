import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initSync, K3ncryptAccount } from '../crypto-wasm/pkg/k3ncrypt_vodozemac.js';

const wasmPath = new URL('../crypto-wasm/pkg/k3ncrypt_vodozemac_bg.wasm', import.meta.url);
initSync({ module: fs.readFileSync(wasmPath) });

const pickleKey = new Uint8Array(32).fill(19);
const domain = new TextEncoder().encode('K3NCRYPT/ROOM-MESSAGE\0');
const identityReference = identity => {
  const canonical = `k3ncrypt:vodozemac-identity:v1\0${identity.curve25519.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}\0${identity.ed25519.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const grouped = createHash('sha256').update(canonical).digest('base64url').toUpperCase().match(/.{1,4}/g).join(' ');
  return `K3 ${grouped}`;
};
const roomMessage = (roomId, senderRef, recipientRef, payload) => {
  const room = Buffer.from(roomId.replaceAll('-', ''), 'hex');
  const event = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
  const sender = Buffer.from(senderRef, 'utf8');
  const recipient = Buffer.from(recipientRef, 'utf8');
  const header = Buffer.alloc(domain.length + 2 + 16 + 2 + sender.length + 2 + recipient.length + 16 + 4);
  let offset = 0;
  Buffer.from(domain).copy(header, offset); offset += domain.length;
  header[offset++] = 1; header[offset++] = 1; room.copy(header, offset); offset += 16;
  header.writeUInt16BE(sender.length, offset); offset += 2; sender.copy(header, offset); offset += sender.length;
  header.writeUInt16BE(recipient.length, offset); offset += 2; recipient.copy(header, offset); offset += recipient.length;
  event.copy(header, offset); offset += 16; header.writeUInt32BE(payload.length, offset);
  return Uint8Array.from(Buffer.concat([Buffer.from([1, 1]), header, payload]));
};
const wrapperRoomMatches = (plaintext, expectedRoomId) => {
  const value = Buffer.from(plaintext);
  let offset = 2 + domain.length + 2;
  const room = value.subarray(offset, offset + 16).toString('hex');
  const expected = expectedRoomId.replaceAll('-', '');
  return room === expected;
};
const alice = K3ncryptAccount.createAccount();
const bob = K3ncryptAccount.createAccount();
const handles = [alice, bob];

try {
  bob.generateOneTimeKeys(2);
  const aliceIdentity = JSON.parse(alice.identityKeys());
  const bobIdentity = JSON.parse(bob.identityKeys());
  const aliceRef = identityReference(aliceIdentity);
  const bobRef = identityReference(bobIdentity);
  const roomA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const roomB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const oneTimeKeys = JSON.parse(bob.oneTimeKeys());
  if (!Array.isArray(oneTimeKeys) || oneTimeKeys.length < 2) throw new Error('Two test pre-keys were not generated.');

  // Model room-local runtimes restored from the same initial account snapshot.
  const initialBobPickle = bob.saveAccount(pickleKey);
  const bobRoomA = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  const bobRoomBStale = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  const bobRoomBIndependent = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  handles.push(bobRoomA, bobRoomBStale, bobRoomBIndependent);

  const outboundA = alice.createOutboundSession(bobIdentity.curve25519, oneTimeKeys[0]);
  const outboundB = alice.createOutboundSession(bobIdentity.curve25519, oneTimeKeys[1]);
  handles.push(outboundA, outboundB);
  const roomACiphertext = outboundA.encrypt(roomMessage(roomA, aliceRef, bobRef, new TextEncoder().encode('room-binding-probe')));
  const roomBCiphertext = outboundB.encrypt(roomMessage(roomB, aliceRef, bobRef, new TextEncoder().encode('independent-room-probe')));

  const firstReplayA = bobRoomA.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const firstReplayB = bobRoomBStale.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const replayPlaintextA = firstReplayA.plaintext();
  const replayPlaintextB = firstReplayB.plaintext();
  const replayAcceptedBySeparatePrekeySnapshots = wrapperRoomMatches(replayPlaintextA, roomA) && wrapperRoomMatches(replayPlaintextB, roomA);
  const wrongRoomFirstPrekeyRejected = !wrapperRoomMatches(replayPlaintextB, roomB);
  replayPlaintextA.fill(0);
  replayPlaintextB.fill(0);
  firstReplayA.free();
  firstReplayB.free();

  const roomBInbound = bobRoomBIndependent.createInboundSession(aliceIdentity.curve25519, roomBCiphertext);
  const establishedRoomBSession = roomBInbound.takeSession();
  handles.push(establishedRoomBSession);
  roomBInbound.free();
  let establishedSessionRejectedRoomAReplay = false;
  try {
    establishedRoomBSession.decrypt(roomACiphertext);
  } catch {
    establishedSessionRejectedRoomAReplay = true;
  }

  if (!replayAcceptedBySeparatePrekeySnapshots || !wrongRoomFirstPrekeyRejected || !establishedSessionRejectedRoomAReplay) {
    throw new Error('Unexpected generated Olm room-binding probe result.');
  }
  console.log(JSON.stringify({
    sameFirstPrekeyCiphertextDecryptsWithSeparateCopiesOfInitialRecipientState: replayAcceptedBySeparatePrekeySnapshots,
    authenticatedRoomWrapperRejectsThatFirstPrekeyOnTheOtherRoom: wrongRoomFirstPrekeyRejected,
    establishedIndependentRoomSessionRejectsTheOtherRoomCiphertext: establishedSessionRejectedRoomAReplay,
    roomIdentifierProvidedToOlmSessionEstablishment: false,
  }));
} finally {
  for (const handle of handles.reverse()) handle.free();
}
