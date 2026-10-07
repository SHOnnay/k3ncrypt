import fs from 'node:fs';
import { initSync, K3ncryptAccount } from '../crypto-wasm/pkg/k3ncrypt_vodozemac.js';

const wasmPath = new URL('../crypto-wasm/pkg/k3ncrypt_vodozemac_bg.wasm', import.meta.url);
initSync({ module: fs.readFileSync(wasmPath) });

const pickleKey = new Uint8Array(32).fill(19);
const alice = K3ncryptAccount.createAccount();
const bob = K3ncryptAccount.createAccount();
const handles = [alice, bob];

try {
  bob.generateOneTimeKeys(2);
  const aliceIdentity = JSON.parse(alice.identityKeys());
  const bobIdentity = JSON.parse(bob.identityKeys());
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
  const roomACiphertext = outboundA.encrypt(new TextEncoder().encode('room-binding-probe'));
  const roomBCiphertext = outboundB.encrypt(new TextEncoder().encode('independent-room-probe'));

  const firstReplayA = bobRoomA.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const firstReplayB = bobRoomBStale.createInboundSession(aliceIdentity.curve25519, roomACiphertext);
  const replayAcceptedBySeparatePrekeySnapshots =
    new TextDecoder().decode(firstReplayA.plaintext()) === 'room-binding-probe' &&
    new TextDecoder().decode(firstReplayB.plaintext()) === 'room-binding-probe';
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

  if (!replayAcceptedBySeparatePrekeySnapshots || !establishedSessionRejectedRoomAReplay) {
    throw new Error('Unexpected generated Olm room-binding probe result.');
  }
  console.log(JSON.stringify({
    sameFirstPrekeyCiphertextDecryptsWithSeparateCopiesOfInitialRecipientState: replayAcceptedBySeparatePrekeySnapshots,
    establishedIndependentRoomSessionRejectsTheOtherRoomCiphertext: establishedSessionRejectedRoomAReplay,
    roomIdentifierProvidedToOlmSessionEstablishment: false,
  }));
} finally {
  for (const handle of handles.reverse()) handle.free();
}
