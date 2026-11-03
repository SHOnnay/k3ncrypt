import React, { useEffect, useState } from 'react';
import { deriveHumanVerificationCode, encodeVerificationQrPayload, verificationQrMatches, type StoredContactIdentity } from '@chat-e2ee/service';
import { LocalQrImage, LocalQrScanner } from '../common/LocalQr';
import { StatusPill } from '../common/StatusPill';
import { verificationPresentation } from './panelPresentation';
import { checkCopy, CHECK_PILL, checkName, checkState } from '../../content/checkCopy';

interface Props {
  label: string; ownFingerprint: string; contact?: StoredContactIdentity; availability?: 'waiting' | 'unavailable';
  sessionHealth: 'healthy' | 'unhealthy' | 'renewal-pending';
  verify(): Promise<void>; unverify(): Promise<void>; acceptChange(): Promise<void>; renew(): Promise<void>; block(): Promise<void>;
  onError(error: unknown): void; onDone(): void;
}

/**
 * M1c check flow (Option B). Scanning or comparing numbers only *enables* the explicit
 * Confirm / "They match" tap; nothing changes trust silently. Android contacts go to the
 * Android path because Android has no verification QR and no shared 30-digit number yet.
 */
type Step = 'android' | 'together' | 'scan' | 'numbers' | 'android-path' | 'show-mine';

/** Shows the exact value in its existing 4-character groups; '-' and '_' are spelled out so they can be read aloud. Value unchanged. */
const SecurityNumberGroups: React.FC<{ value: string }> = ({ value }) => <ol className="security-number-groups" aria-label="Your security number">
  {value.split(' ').map((group, index) => <li key={index}><span className="security-number-groups__index" aria-hidden="true">{index + 1}</span><code>{group}</code>{/[-_]/.test(group) && <small>{[...group].map((char) => char === '-' ? 'dash' : char === '_' ? 'underscore' : char).join(' ')}</small>}</li>)}
</ol>;

export const VerificationPanel: React.FC<Props> = ({ label, ownFingerprint, contact, availability = 'waiting', sessionHealth, verify, unverify, acceptChange, renew, block, onError, onDone }) => {
  const [step, setStep] = useState<Step>('android');
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const [notice, setNotice] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [renewalConfirmed, setRenewalConfirmed] = useState(false);
  const changed = contact?.changeStatus === 'changed-pending-review';
  const peer = changed ? contact?.pendingIdentity?.identityId : contact?.identityId;
  const binding = JSON.stringify([ownFingerprint, peer]);
  const presentation = verificationPresentation(contact, availability);
  const state = checkState(contact);
  const checked = state === 'checked';
  const name = checkName(label);
  const myCode = encodeVerificationQrPayload(ownFingerprint);
  useEffect(() => {
    let active = true; setCode(''); setConfirmed(''); setStep('android'); setNotice(''); setMismatch(false); setRenewalConfirmed(false);
    if (peer) void deriveHumanVerificationCode(ownFingerprint, peer).then((value) => { if (active) setCode(value); }).catch(onError);
    return () => { active = false; };
  }, [ownFingerprint, peer]);

  const scan = (text: string) => {
    setMismatch(false);
    if (!peer || !verificationQrMatches(text, peer)) { setConfirmed(''); setNotice(checkCopy.scanWrong(name)); return; }
    setConfirmed(binding); setNotice(checkCopy.scanMatched(name));
  };
  // A changed identity is accepted only by the same explicit tap that confirms the new number.
  const confirm = async (next: Step | 'done') => {
    try {
      if (changed) await acceptChange();
      await verify();
      setConfirmed(''); setNotice(`${checkCopy.checked(name)} ${checkCopy.askBack(name)}`);
      if (next !== 'done') setStep(next);
    } catch (error) { onError(error); }
  };
  const tone = checked ? 'positive' : 'quiet';

  return <>
    <div className="detail-intro"><h3>{checkCopy.title(name)}</h3></div>
    <div className={`verification-summary state-card ${checked ? 'state-card--positive' : ''} ${state === 'changed' ? 'state-card--attention' : ''}`}>
      <div><StatusPill tone={tone}>{state === 'unavailable' ? presentation.title : CHECK_PILL[state]}</StatusPill>{state === 'unavailable' && <p>{presentation.description}</p>}</div>
    </div>
    {peer ? <>
      {changed && <p className="check-changed" role="alert">{checkCopy.changed(name)}</p>}
      {!checked && <div className="check-flow">
        {step === 'android' && <section aria-label="Step 1">
          <h4>{checkCopy.androidQuestion(name)}</h4>
          <div className="verification-actions">
            <button className="btn btn--secondary" type="button" onClick={() => setStep('android-path')}>Yes, Android</button>
            <button className="btn btn--primary" type="button" onClick={() => setStep('together')}>No</button>
          </div>
        </section>}

        {step === 'together' && <section aria-label="Step 2">
          <h4>{checkCopy.togetherQuestion(name)}</h4>
          <div className="verification-actions">
            <button className="btn btn--primary" type="button" onClick={() => { setNotice(''); setStep('scan'); }}>Yes, we’re together</button>
            <button className="btn btn--secondary" type="button" onClick={() => { setNotice(''); setStep('numbers'); }}>No, we’ll call</button>
          </div>
        </section>}

        {step === 'scan' && <section aria-label="Scan their code">
          <h4>{checkCopy.scanTitle(name)}</h4>
          <p>{checkCopy.scanHelp(name)}</p>
          <LocalQrScanner onScanned={scan} startLabel="Start camera" onFallback={() => { setNotice(''); setConfirmed(''); setStep('numbers'); }} fallbackLabel={checkCopy.showNumbersInstead} />
          <button className="btn btn--link check-numbers-link" type="button" onClick={() => { setNotice(''); setConfirmed(''); setStep('numbers'); }}>{checkCopy.showNumbersInstead}</button>
          {confirmed === binding && <button className="btn btn--primary" type="button" onClick={() => void confirm('show-mine')}>Confirm</button>}
        </section>}

        {step === 'numbers' && <section aria-label="Compare numbers">
          <p>{checkCopy.callFirst(name)}</p>
          <p>{checkCopy.numbersHelp(name)}</p>
          <code className="human-verification-code" aria-label="Security number">{code || 'Preparing…'}</code>
          <div className="verification-actions">
            <button className="btn btn--primary" type="button" disabled={!code} onClick={() => { setMismatch(false); setConfirmed(binding); void confirm('done'); }}>They match</button>
            <button className="btn btn--secondary" type="button" onClick={() => { setConfirmed(''); setMismatch(true); }}>They don’t match</button>
          </div>
          {mismatch && <p className="check-mismatch" role="alert">{checkCopy.numbersMismatch}</p>}
        </section>}

        {step === 'android-path' && <section aria-label="Android contact">
          <h4>{checkCopy.androidTitle(name)}</h4>
          <p>{checkCopy.androidHelp(name)}</p>
          <strong>Your security number</strong>
          <SecurityNumberGroups value={ownFingerprint} />
          <p className="check-read-hint">{checkCopy.readEachCharacter}</p>
          <button className="btn btn--secondary" type="button" onClick={() => void navigator.clipboard.writeText(ownFingerprint).then(() => setNotice('Copied. Send it only in a way you trust.')).catch(() => setNotice('Could not copy. Read the groups aloud instead.'))}>Copy my security number</button>
          <p className="check-limit">{checkCopy.androidLimit(name)}</p>
          <button className="btn btn--secondary" type="button" onClick={() => setStep('android')}>Back</button>
        </section>}
      </div>}

      {(checked || step === 'show-mine') && <section className="check-done" aria-label="Checked">
        {step === 'show-mine' && <h4>{checkCopy.showMyCodeTitle(name)}</h4>}
        {step !== 'show-mine' && <p>{checkCopy.checked(name)} {checkCopy.askBack(name)}</p>}
        {step === 'show-mine' ? <LocalQrImage value={myCode} label="Your code for scanning" /> : <button className="btn btn--secondary" type="button" onClick={() => setStep('show-mine')}>Show my code</button>}
        <button type="button" className="btn btn--primary" onClick={onDone}>Back to chat</button>
      </section>}
    </> : <button className="btn btn--secondary" type="button" onClick={onDone}>Back to chats</button>}
    {notice && <p role="status">{notice}</p>}
    <details className="verification-security-details"><summary>More options</summary>
      {!checked && <details className="check-show-mine"><summary>Show my code</summary><p>{checkCopy.askBack(name)}</p><LocalQrImage value={myCode} label="Your code for scanning" /></details>}
      <p>Names can be copied by anyone. Only the security number shows it’s really them. Checking never happens on its own: only your tap changes it.</p>
      <strong>Your full security number</strong><code className="verification-code">{ownFingerprint}</code>
      <strong>{name === 'your contact' ? 'Their' : `${name}’s`} full security number</strong><code className="verification-code">{peer ?? 'Not available yet'}</code>
      {changed && <><strong>Previous security number</strong><code className="verification-code">{contact?.identityId}</code></>}
      <label>My code as text<textarea aria-label="My code as text" readOnly value={myCode} /></label>
      <button className="btn btn--secondary" type="button" onClick={() => void navigator.clipboard.writeText(myCode)}>Copy my code as text</button>
      <label>Their code as text (if the camera doesn’t work)<textarea aria-label="Their code as text" value={qrInput} onChange={(event) => setQrInput(event.target.value)} /></label>
      <button className="btn btn--secondary" type="button" disabled={!peer} onClick={() => { scan(qrInput); setStep('scan'); }}>Check their code</button>
      {changed && <button type="button" className="btn btn--danger" onClick={() => block().catch(onError)}>Block conversation</button>}
      {checked && <button className="btn btn--secondary" type="button" onClick={() => unverify().catch(onError)}>Mark as not checked</button>}
      {checked && sessionHealth === 'unhealthy' && <><p>This saved encrypted session needs a checked renewal. Your history is kept.</p><label><input type="checkbox" checked={renewalConfirmed} onChange={(event) => setRenewalConfirmed(event.target.checked)} /> I compared the security number again on a call I trust</label><button className="btn btn--secondary" disabled={!renewalConfirmed} type="button" onClick={() => renew().catch(onError)}>Prepare renewal</button></>}
      {sessionHealth === 'renewal-pending' && <p>Ask your contact to prepare the renewal, then send a text message. Calls stay paused until it’s accepted.</p>}
    </details>
  </>;
};
