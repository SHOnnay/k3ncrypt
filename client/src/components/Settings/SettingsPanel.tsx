import React, { useEffect, useState } from 'react';
import { decodeVerificationQrPayload, encodeVerificationQrPayload } from '@chat-e2ee/service';
import { useChat } from '../../context/ChatContext';
import { useTheme } from '../../theme/ThemeContext';
import { Avatar } from '../common/Avatar';
import { StatusPill } from '../common/StatusPill';
import { ThemeSwitcher } from '../common/ThemeSwitcher';
import {
  ArrowLeftIcon,
  BellIcon,
  CloseIcon,
  InfoIcon,
  LockIcon,
  MicIcon,
  NetworkIcon,
  PaletteIcon,
  ShieldIcon,
  StorageIcon,
  UserIcon,
} from '../common/icons';
import { SettingsRow } from './SettingsRow';
import { copy } from '../../content/copy';
import './SettingsPanel.css';

type SettingsView = 'settings' | 'privacy' | 'appearance' | 'network' | 'verification';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const viewTitles: Record<SettingsView, string> = {
  settings: 'Settings',
  privacy: 'Privacy',
  appearance: 'Appearance',
  network: 'Connection',
  verification: copy.verification.title,
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const [view, setView] = useState<SettingsView>('settings');
  const { channelHash, isConnected, protocolMode, userId, ownFingerprint, contactIdentity, verifyContact, acceptChangedIdentity, deleteChannel, deviceLifecycleState, pendingDeviceEnrollment, pendingDeviceApproval, requestDeviceEnrollment, approveDeviceEnrollment, rejectDeviceEnrollment, confirmDeviceEnrollment, revokeDevice, privacyPreferences, updatePrivacyPreferences, permissionStatus, refreshPermissionStatus, syncStatus } = useChat();
  const [comparisonConfirmed, setComparisonConfirmed] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [qrMatch, setQrMatch] = useState(false);
  const [qrError, setQrError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [deviceIdInput, setDeviceIdInput] = useState('');
  const [deviceIdentityInput, setDeviceIdentityInput] = useState('');
  const { theme } = useTheme();

  useEffect(() => {
    if (!isOpen) {
      setView('settings');
      setQrInput('');
      setQrMatch(false);
      setQrError('');
      setRecoveryNotice('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="settings-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="settings-panel" aria-label={viewTitles[view]}>
        <header className="settings-panel__header">
          {view !== 'settings' ? (
            <button className="quiet-icon-button" type="button" onClick={() => setView('settings')} aria-label="Back to settings"><ArrowLeftIcon size={19} /></button>
          ) : <span className="settings-panel__spacer" />}
          <div><span className="eyebrow">Your private space</span><h2>{viewTitles[view]}</h2></div>
          <button className="quiet-icon-button" type="button" onClick={onClose} aria-label="Close settings"><CloseIcon size={19} /></button>
        </header>

        <div className="settings-panel__body">
          {view === 'settings' && (
            <>
              <div className="identity-card">
                <Avatar label="You" size="large" />
                <div><strong>Your space</strong><p>{protocolMode === 'modern' ? 'Your private identity is on this device.' : 'Identity setup is available for modern contacts.'}</p></div>
                <StatusPill tone="quiet">Local</StatusPill>
              </div>
              <section className="settings-group" aria-label="Settings sections">
                <SettingsRow icon={<UserIcon size={18} />} title="Identity" description="Your private identity" onClick={() => setView('verification')} />
                <SettingsRow icon={<ShieldIcon size={18} />} title="Privacy" description="Conversation and device privacy" onClick={() => setView('privacy')} />
                <SettingsRow icon={<NetworkIcon size={18} />} title="Connection" description="How this space reaches others" onClick={() => setView('network')} />
                <SettingsRow icon={<PaletteIcon size={18} />} title="Appearance" description={theme === 'paper' ? 'Paper & Ink' : 'Slate Dusk'} onClick={() => setView('appearance')} />
              </section>
              <section className="settings-group" aria-label="Future settings">
                <SettingsRow icon={<BellIcon size={18} />} title="Notifications" description="Notification controls" status="Coming soon" disabled />
                <SettingsRow icon={<StorageIcon size={18} />} title="Storage" description="Local message storage" status="Not available" disabled />
                <SettingsRow icon={<InfoIcon size={18} />} title="About" description="K3ncrypt · private by design" status="Prototype" />
              </section>
            </>
          )}

          {view === 'appearance' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Choose a feeling</h3><p>Appearance stays on this device and never changes how your conversations work.</p></div>
              <ThemeSwitcher />
            </section>
          )}

          {view === 'privacy' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Designed around your privacy</h3><p>{protocolMode === 'modern' ? 'Your modern contact uses a lasting identity on this device.' : 'Your current conversation uses its private invitation to protect messages in transit.'}</p></div>
              <div className="state-card state-card--positive"><ShieldIcon size={21} /><div><strong>Conversation protection is on</strong><p>{protocolMode === 'modern' ? 'Your identity and conversation state stay in your local encrypted vault.' : 'Sensitive invitation details stay in the link fragment and are not sent as a normal page request.'}</p></div></div>
              <div className="preference-list">
                <SettingsRow icon={<LockIcon size={17} />} title="App lock" description="Modern account data requires the local vault passphrase" status={protocolMode === 'modern' ? 'On' : 'Modern only'} />
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notification previews</strong><small>Show message content in system notifications</small></span><input type="checkbox" checked={privacyPreferences.notificationPreviews} onChange={(event) => updatePrivacyPreferences({ notificationPreviews: event.target.checked })} /></label>
                <SettingsRow icon={<InfoIcon size={17} />} title="Link previews" description="No link previews are generated" status="Off" />
                <label className="settings-row"><span className="settings-row__icon"><StorageIcon size={17} /></span><span className="settings-row__copy"><strong>Media auto-download</strong><small>Open protected media only when you choose</small></span><input type="checkbox" checked={privacyPreferences.mediaAutoDownload} onChange={(event) => updatePrivacyPreferences({ mediaAutoDownload: event.target.checked })} /></label>
                <SettingsRow icon={<ShieldIcon size={17} />} title="Analytics" description="No usage analytics are sent" status="Off" />
                <SettingsRow icon={<MicIcon size={17} />} title="Microphone permission" description="Requested only from a call or voice-note action" status={permissionStatus.microphone} />
                <SettingsRow icon={<InfoIcon size={17} />} title="Camera permission" description="No background camera capture" status={permissionStatus.camera} />
                <button className="btn btn--secondary" type="button" onClick={() => refreshPermissionStatus()}>Refresh permissions</button>
              </div>
            </section>
          )}

          {view === 'network' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>A simple connection</h3><p>K3ncrypt currently uses its configured relay to help two people meet.</p></div>
              <div className="network-status">
                <span className={`network-pulse ${isConnected ? 'online' : ''}`} />
                <div><strong>{isConnected ? 'Conversation connected' : 'Waiting for the other person'}</strong><p>Relay connection · browser</p></div>
                <StatusPill tone={isConnected ? 'positive' : 'quiet'}>{isConnected ? 'Online' : 'Waiting'}</StatusPill>
              </div>
              <div className="network-status"><span className={`network-pulse ${syncStatus === 'ready' ? 'online' : ''}`} /><div><strong>Device sync</strong><p>Authenticated state synchronization</p></div><StatusPill tone={syncStatus === 'ready' ? 'positive' : 'quiet'}>{syncStatus}</StatusPill></div>
              <div className="preference-list">
                <SettingsRow icon={<NetworkIcon size={17} />} title="Local communication mode" description="Connect without the internet when nearby" status="Coming soon" disabled />
                <SettingsRow icon={<ShieldIcon size={17} />} title="Private routing" description="Alternative network routes" status="Not available" disabled />
              </div>
              <p className="detail-note">No network mode shown here is simulated. Only the current relay connection is active.</p>
            </section>
          )}

          {view === 'verification' && (
            <section className="settings-detail verification-view">
              <div className="verification-mark"><ShieldIcon size={30} /></div>
              <h3>{copy.verification.title}</h3>
              <p>{copy.verification.description}</p>
              {protocolMode === 'modern' && ownFingerprint ? <div className="unavailable-card">
                <strong>Your fingerprint</strong><code className="verification-code">{ownFingerprint}</code>
                <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(ownFingerprint)}>Copy yours</button>
                <strong>Verification QR payload</strong>
                <p>Show this temporary code to your contact. It contains public fingerprint information only and is never saved.</p>
                <textarea className="verification-qr-payload" aria-label="Your verification QR payload" readOnly value={encodeVerificationQrPayload(ownFingerprint)} />
                <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(encodeVerificationQrPayload(ownFingerprint))}>Copy verification code</button>
                {contactIdentity ? <>
                  <StatusPill tone={contactIdentity.verification === 'verified' && contactIdentity.changeStatus === 'unchanged' ? 'positive' : 'quiet'}>{contactIdentity.changeStatus === 'changed-pending-review' ? 'Identity changed · review required' : contactIdentity.verification === 'verified' ? 'Verified' : 'Unverified'}</StatusPill>
                  <strong>Contact fingerprint</strong><code className="verification-code">{contactIdentity.identityId}</code>
                  <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(contactIdentity.identityId)}>Copy contact fingerprint</button>
                  {contactIdentity.changeStatus === 'changed-pending-review' ? <>
                    <p role="alert">This identity changed. Your previous verification is no longer active. The reason is unknown.</p>
                    <strong>Previous fingerprint</strong><code className="verification-code">{contactIdentity.identityId}</code>
                    <strong>New fingerprint</strong><code className="verification-code">{contactIdentity.pendingIdentity?.identityId ?? 'Unavailable'}</code>
                    <div className="verification-actions">
                      <button className="btn btn--secondary" type="button" onClick={() => { setComparisonConfirmed(false); setRecoveryNotice('Compare the new fingerprint through another trusted channel before accepting it.'); }}>Verify again</button>
                      <button className="btn btn--secondary" type="button" onClick={() => setRecoveryNotice('Change rejected. This conversation remains unverified.')}>Reject change</button>
                      <button className="btn btn--danger" type="button" onClick={() => deleteChannel().catch(() => setVerificationError('Could not block this conversation.'))}>Block conversation</button>
                    </div>
                    <label><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /> I compared the new fingerprint with my contact</label>
                    <button className="btn btn--secondary" type="button" disabled={!comparisonConfirmed} onClick={() => acceptChangedIdentity().catch(() => setVerificationError('Could not accept this identity change.'))}>Accept new identity after review</button>
                  </> : contactIdentity.verification !== 'verified' ? <>
                    <p>Compare this fingerprint with your contact through another trusted way before marking it verified.</p>
                    <label htmlFor="verification-qr-input">Paste your contact&apos;s temporary verification code</label>
                    <textarea id="verification-qr-input" className="verification-qr-payload" value={qrInput} onChange={(event) => { setQrInput(event.target.value); setQrError(''); setQrMatch(false); }} />
                    <button className="btn btn--secondary" type="button" onClick={() => {
                      try {
                        const parsed = decodeVerificationQrPayload(qrInput);
                        if (parsed.fingerprint !== contactIdentity.identityId) throw new Error('Fingerprint does not match this contact.');
                        setQrMatch(true);
                        setQrError('');
                      } catch { setQrMatch(false); setQrError('That verification code is invalid or does not match this contact.'); }
                    }}>Check verification code</button>
                    {qrError && <p role="alert">{qrError}</p>}
                    <label><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /> I compared the fingerprints with my contact</label>
                    <button className="btn btn--primary" type="button" disabled={!comparisonConfirmed} onClick={() => {
                      verifyContact().then(() => { setComparisonConfirmed(false); setVerificationError(''); }).catch(() => setVerificationError('Could not save verification. Try again.'));
                    }}>Mark as verified</button>
                    {qrMatch && <p role="status">The code matches this contact&apos;s fingerprint. Continue only after confirming it with them.</p>}
                  </> : <p>You marked this contact as verified on this device.</p>}
                </> : <p>Your contact will appear here after the first message.</p>}
                {protocolMode === 'modern' && <div className="device-management" aria-label="Device management">
                  <strong>Your devices</strong>
                  <p>Device changes require an authenticated modern session and explicit approval.</p>
                  {deviceLifecycleState?.list.devices.map((device) => <div className="network-status" key={device.deviceId}>
                    <div><strong>{device.deviceId === userId ? 'This device' : device.deviceId}</strong><p>{device.state}</p></div>
                    {device.deviceId !== userId && device.state !== 'revoked' && <button className="btn btn--danger" type="button" onClick={() => { if (window.confirm('Confirm removing this device from your private device list?')) revokeDevice(device.deviceId).catch(() => setVerificationError('Could not revoke this device.')); }}>Revoke</button>}
                  </div>)}
                  <label htmlFor="device-id-input">New device ID</label>
                  <input id="device-id-input" className="verification-qr-payload" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} placeholder="Public device identifier" />
                  <label htmlFor="device-identity-input">New public identity reference</label>
                  <input id="device-identity-input" className="verification-qr-payload" value={deviceIdentityInput} onChange={(event) => setDeviceIdentityInput(event.target.value)} placeholder="Public identity reference" />
                  <button className="btn btn--secondary" type="button" disabled={!deviceIdInput || !deviceIdentityInput} onClick={() => requestDeviceEnrollment(deviceIdInput, deviceIdentityInput, 'Olm-Curve25519+Ed25519').then(() => { setDeviceIdInput(''); setDeviceIdentityInput(''); setRecoveryNotice('Enrollment request sent through the protected session.'); }).catch(() => setVerificationError('Could not send the enrollment request.'))}>Request device approval</button>
                  {pendingDeviceEnrollment && <div className="state-card state-card--positive"><strong>Device approval requested</strong><p>{pendingDeviceEnrollment.requestedDeviceId}</p><div className="verification-actions"><button className="btn btn--primary" type="button" onClick={() => approveDeviceEnrollment().catch(() => setVerificationError('Could not approve this device.'))}>Approve</button><button className="btn btn--secondary" type="button" onClick={() => rejectDeviceEnrollment().catch(() => setVerificationError('Could not reject this device.'))}>Reject</button></div></div>}
                  {pendingDeviceApproval && <div className="state-card state-card--positive"><strong>Device approval received</strong><p>{pendingDeviceApproval.authorization.targetDeviceId}</p><button className="btn btn--primary" type="button" onClick={() => confirmDeviceEnrollment().then(() => setRecoveryNotice('This independent device is now active on the account.')).catch(() => setVerificationError('Could not confirm device enrollment.'))}>Confirm on this device</button></div>}
                </div>}
                {recoveryNotice && <p role="status">{recoveryNotice}</p>}
                {verificationError && <p role="alert">{verificationError}</p>}
              </div> : <div className="unavailable-card"><StatusPill tone="quiet">Not available in this conversation</StatusPill><p>Verification is available for new modern private contacts.</p></div>}
              {channelHash && <p className="room-reference">Current room reference <code>{channelHash.slice(0, 8)}…</code></p>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
