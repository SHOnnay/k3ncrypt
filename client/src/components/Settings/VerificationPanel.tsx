import React, { useEffect, useState } from 'react';
import { deriveHumanVerificationCode, encodeVerificationQrPayload, verificationQrMatches, type StoredContactIdentity } from '@chat-e2ee/service';
import { LocalQrImage, LocalQrScanner } from '../common/LocalQr';
import { StatusPill } from '../common/StatusPill';

interface Props {
  label: string; ownFingerprint: string; contact?: StoredContactIdentity;
  sessionHealth: 'healthy' | 'unhealthy' | 'renewal-pending';
  verify(): Promise<void>; unverify(): Promise<void>; acceptChange(): Promise<void>; renew(): Promise<void>; block(): Promise<void>;
  onError(error: unknown): void; onDone(): void;
}

export const VerificationPanel: React.FC<Props> = ({ label, ownFingerprint, contact, sessionHealth, verify, unverify, acceptChange, renew, block, onError, onDone }) => {
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const [notice, setNotice] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [renewalConfirmed, setRenewalConfirmed] = useState(false);
  const changed = contact?.changeStatus === 'changed-pending-review';
  const peer = changed ? contact?.pendingIdentity?.identityId : contact?.identityId;
  const binding = JSON.stringify([ownFingerprint, peer]);
  const verified = contact?.verification === 'verified' && !changed;
  useEffect(() => {
    let active = true; setCode(''); setConfirmed(''); setNotice(''); setRenewalConfirmed(false);
    if (peer) void deriveHumanVerificationCode(ownFingerprint, peer).then((value) => { if (active) setCode(value); }).catch(onError);
    return () => { active = false; };
  }, [ownFingerprint, peer]);
  const scan = (text: string) => {
    if (!peer || !verificationQrMatches(text, peer)) { setConfirmed(''); setNotice('This QR does not match this contact. Do not verify.'); return; }
    setConfirmed(binding); setNotice('Identity matches. Choose Mark as verified to confirm.');
  };
  return <>
    <h3>{verified ? label : `Verify ${label}`}</h3>
    <p>Make sure you are really talking to {label}.</p>
    <StatusPill tone={verified ? 'positive' : 'quiet'}>{changed ? 'Identity changed · review required' : verified ? 'Verified' : 'Unverified'}</StatusPill>
    {!peer ? <p>This contact’s authenticated identity is not available yet. Keep the conversation open while they connect.</p> : <>
      {changed && <p role="alert">This contact’s identity changed. Compare the new code using another trusted way before accepting it. They will still need explicit verification.</p>}
      {!verified && <>
        <h4>Together?</h4><p>Show your verification QR, then scan theirs.</p>
        <LocalQrImage value={encodeVerificationQrPayload(ownFingerprint)} label="Your verification QR" />
        <LocalQrScanner onScanned={scan} />
        <h4>Apart?</h4><p>Compare this security code with them. Both devices must show the same numbers.</p>
        <code className="human-verification-code" aria-label="Comparison security code">{code || 'Preparing code…'}</code>
        <div className="verification-actions"><button className="btn btn--secondary" type="button" disabled={!code} onClick={() => { setConfirmed(binding); setNotice('You confirmed the codes match. Choose Mark as verified.'); }}>Codes match</button><button className="btn btn--secondary" type="button" onClick={() => { setConfirmed(''); setNotice('Do not verify. Compare again using another trusted way.'); }}>They don&apos;t match</button></div>
        {changed ? <button className="btn btn--secondary" type="button" disabled={confirmed !== binding} onClick={() => acceptChange().then(() => setConfirmed('')).catch(onError)}>Accept new identity after review</button> : <button className="btn btn--primary" type="button" disabled={confirmed !== binding} onClick={() => verify().then(() => { setConfirmed(''); setNotice('Verified on this device.'); }).catch(onError)}>Mark as verified</button>}
      </>}
      {verified && <><p>You verified this contact on this device.</p><button type="button" className="btn btn--primary" onClick={onDone}>Back to chat</button></>}
    </>}
    {notice && <p role="status">{notice}</p>}
    <details className="verification-security-details"><summary>Security details</summary>
      <p>Names are claims, not identity proof. QR compares the complete pinned fingerprint. The grouped code is derived from both complete identities. Compare using a trusted channel; only your explicit action changes verification.</p>
      <strong>Your security code</strong><code className="verification-code">{ownFingerprint}</code>
      <strong>Contact security code</strong><code className="verification-code">{peer ?? 'Unavailable'}</code>
      {changed && <><strong>Previous security code</strong><code className="verification-code">{contact?.identityId}</code></>}
      <textarea aria-label="Your verification QR payload" readOnly value={encodeVerificationQrPayload(ownFingerprint)} />
      <button className="btn btn--secondary" type="button" onClick={() => void navigator.clipboard.writeText(encodeVerificationQrPayload(ownFingerprint))}>Copy verification QR payload</button>
      <label>Paste a shared QR payload (camera alternative)<textarea aria-label="Contact verification QR payload" value={qrInput} onChange={(event) => setQrInput(event.target.value)} /></label>
      <button className="btn btn--secondary" type="button" onClick={() => scan(qrInput)}>Check shared QR payload</button>
      {changed && <button type="button" className="btn btn--danger" onClick={() => block().catch(onError)}>Block conversation</button>}
      {verified && <button className="btn btn--secondary" type="button" onClick={() => unverify().catch(onError)}>Mark unverified</button>}
      {verified && sessionHealth === 'unhealthy' && <><p>This saved encrypted session needs a verified renewal. Your identity and history are preserved.</p><label><input type="checkbox" checked={renewalConfirmed} onChange={(event) => setRenewalConfirmed(event.target.checked)} /> I compared the contact security code again using a trusted channel</label><button className="btn btn--secondary" disabled={!renewalConfirmed} type="button" onClick={() => renew().catch(onError)}>Prepare verified session renewal</button></>}
      {sessionHealth === 'renewal-pending' && <p>Ask your contact to prepare verified renewal, then send a text message. Calls stay paused until accepted.</p>}
    </details>
  </>;
};
