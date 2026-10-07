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
const wrapperBindingsMatch = (plaintext, expectedRoomId, expectedSender, expectedRecipient) => {
  const value = Buffer.from(plaintext);
  let offset = 2 + domain.length + 2;
  const room = value.subarray(offset, offset + 16).toString('hex');
  const expected = expectedRoomId.replaceAll('-', '');
  offset += 16;
  const senderLength = value.readUInt16BE(offset); offset += 2;
  const sender = value.subarray(offset, offset + senderLength).toString('utf8'); offset += senderLength;
  const recipientLength = value.readUInt16BE(offset); offset += 2;
  const recipient = value.subarray(offset, offset + recipientLength).toString('utf8');
  return room === expected && sender === expectedSender && recipient === expectedRecipient;
};
const alice = K3ncryptAccount.createAccount();
const bob = K3ncryptAccount.createAccount();
const mallory = K3ncryptAccount.createAccount();
const handles = [alice, bob, mallory];

try {
  bob.generateOneTimeKeys(2);
  const aliceIdentity = JSON.parse(alice.identityKeys());
  const bobIdentity = JSON.parse(bob.identityKeys());
  const malloryIdentity = JSON.parse(mallory.identityKeys());
  const aliceRef = identityReference(aliceIdentity);
  const bobRef = identityReference(bobIdentity);
  const malloryRef = identityReference(malloryIdentity);
  const roomA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const roomB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const oneTimeKeys = JSON.parse(bob.oneTimeKeys());
  if (!Array.isArray(oneTimeKeys) || oneTimeKeys.length < 2) throw new Error('Two test pre-keys were not generated.');

  // Model room-local runtimes restored from the same initial account snapshot.
  const initialBobPickle = bob.saveAccount(pickleKey);
  const bobRoomA = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  const bobRoomBStale = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  const bobRoomBIndependent = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  const bobRoomAEstablished = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  const bobCurveSubstitution = K3ncryptAccount.loadAccount(initialBobPickle, pickleKey);
  handles.push(bobRoomA, bobRoomBStale, bobRoomBIndependent, bobRoomAEstablished, bobCurveSubstitution);

  const outboundA = alice.createOutboundSession(bobIdentity.curve25519, oneTimeKeys[0]);
  const outboundB = alice.createOutboundSession(bobIdentity.curve25519, oneTimeKeys[1]);
  handles.push(outboundA, outboundB);
  const roomACiphertext = outboundA.encrypt(roomMessage(roomA, aliceRef, bobRef, new TextEncoder().encode('room-binding-probe')));
  const roomBCiphertext = outboundB.encrypt(roomMessage(roomB, aliceRef, bobRef, new TextEncoder().encode('independent-room-probe')));

  const firstReplayA = bobRoomA.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const firstReplayB = bobRoomBStale.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const replayPlaintextA = firstReplayA.plaintext();
  const replayPlaintextB = firstReplayB.plaintext();
  const replayAcceptedBySeparatePrekeySnapshots = wrapperBindingsMatch(replayPlaintextA, roomA, aliceRef, bobRef) && wrapperBindingsMatch(replayPlaintextB, roomA, aliceRef, bobRef);
  const wrongRoomFirstPrekeyRejected = !wrapperBindingsMatch(replayPlaintextB, roomB, aliceRef, bobRef);
  replayPlaintextA.fill(0);
  replayPlaintextB.fill(0);
  firstReplayA.free();
  firstReplayB.free();

  let substitutedBundleCurveRejected = false;
  try { bobCurveSubstitution.createInboundSession(malloryIdentity.curve25519, roomACiphertext); }
  catch { substitutedBundleCurveRejected = true; }

  const establishedInbound = bobRoomAEstablished.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const establishedPlaintext = establishedInbound.plaintext();
  const establishedSession = establishedInbound.takeSession();
  handles.push(establishedSession);
  establishedPlaintext.fill(0);
  establishedInbound.free();
  const forgedClaimCiphertext = outboundA.encrypt(roomMessage(roomA, malloryRef, bobRef, new TextEncoder().encode('forged K3 sender claim')));
  const forgedClaimPlaintext = establishedSession.decrypt(forgedClaimCiphertext);
  const firstPrekeyForgedK3Rejected = !wrapperBindingsMatch(forgedClaimPlaintext, roomA, aliceRef, bobRef);
  forgedClaimPlaintext.fill(0);

  const forgedEstablishedCiphertext = outboundA.encrypt(roomMessage(roomA, malloryRef, bobRef, new TextEncoder().encode('forged established sender claim')));
  const forgedEstablishedPlaintext = establishedSession.decrypt(forgedEstablishedCiphertext);
  const establishedForgedK3Rejected = !wrapperBindingsMatch(forgedEstablishedPlaintext, roomA, aliceRef, bobRef);
  forgedEstablishedPlaintext.fill(0);

  const maxUserPayload = new Uint8Array(16 * 1024).fill(0x61);
  const maxUserMessage = outboundA.encrypt(roomMessage(roomA, aliceRef, bobRef, maxUserPayload));
  const maxRelayFrameBytes = Buffer.byteLength(JSON.stringify({
    envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: maxUserMessage } },
    recipientRoutingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }));

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

  if (!replayAcceptedBySeparatePrekeySnapshots || !wrongRoomFirstPrekeyRejected || !establishedSessionRejectedRoomAReplay ||
      !substitutedBundleCurveRejected || !firstPrekeyForgedK3Rejected || !establishedForgedK3Rejected) {
    throw new Error('Unexpected generated Olm room-binding probe result.');
  }
  if (maxRelayFrameBytes > 32 * 1024) throw new Error('The configured user message maximum exceeds the existing relay envelope cap.');
  console.log(JSON.stringify({
    sameFirstPrekeyCiphertextDecryptsWithSeparateCopiesOfInitialRecipientState: replayAcceptedBySeparatePrekeySnapshots,
    authenticatedRoomWrapperRejectsThatFirstPrekeyOnTheOtherRoom: wrongRoomFirstPrekeyRejected,
    establishedIndependentRoomSessionRejectsTheOtherRoomCiphertext: establishedSessionRejectedRoomAReplay,
    fetchedBundleCurveSubstitutionCannotOpenTheActualSenderPrekey: substitutedBundleCurveRejected,
    firstPrekeyK1SessionRejectsWrapperClaimingK2: firstPrekeyForgedK3Rejected,
    establishedK1SessionRejectsWrapperClaimingK2: establishedForgedK3Rejected,
    '16KiBUserMessageRelayJsonBytes': maxRelayFrameBytes,
    roomIdentifierProvidedToOlmSessionEstablishment: false,
  }));
} finally {
  for (const handle of handles.reverse()) handle.free();
}
