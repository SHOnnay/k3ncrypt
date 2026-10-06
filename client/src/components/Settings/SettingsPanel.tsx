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

type SettingsView = 'settings' | 'profile' | 'devices' | 'privacy' | 'notifications' | 'calls' | 'appearance' | 'network' | 'verification';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const viewTitles: Record<SettingsView, string> = {
  settings: 'Settings',
  profile: 'Profile',
  devices: 'Devices',
  privacy: 'Privacy',
  notifications: 'Notifications',
  calls: 'Calls',
  appearance: 'Appearance',
  network: 'Connection',
  verification: 'Security',
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const [view, setView] = useState<SettingsView>('settings');
  const { channelHash, isConnected, protocolMode, userId, ownFingerprint, contactIdentity, verifyContact, unverifyContact, acceptChangedIdentity, prepareVerifiedSessionRenewal, sessionHealth, deleteChannel, deviceLifecycleState, pendingDeviceEnrollment, pendingDeviceApproval, requestDeviceEnrollment, approveDeviceEnrollment, rejectDeviceEnrollment, confirmDeviceEnrollment, revokeDevice, privacyPreferences, updatePrivacyPreferences, permissionStatus, refreshPermissionStatus, syncStatus, profileDisplayName, updateProfileDisplayName, accountState } = useChat();
  const [comparisonConfirmed, setComparisonConfirmed] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [qrMatch, setQrMatch] = useState(false);
  const [qrError, setQrError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [deviceIdInput, setDeviceIdInput] = useState('');
  const [deviceIdentityInput, setDeviceIdentityInput] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState(profileDisplayName);
  const { theme } = useTheme();

  useEffect(() => {
    setProfileNameDraft(profileDisplayName);
  }, [profileDisplayName]);

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
                <Avatar label={profileDisplayName} size="large" />
                <div><strong>{profileDisplayName}</strong><p>{protocolMode === 'modern' ? 'Your private identity is on this device.' : 'Identity setup is available for modern contacts.'}</p></div>
                <StatusPill tone="quiet">Local</StatusPill>
              </div>
              <section className="settings-group" aria-label="Personal settings">
                <p className="settings-group__label">Personal</p>
                <SettingsRow icon={<UserIcon size={18} />} title="Profile" description="Your name and local contact nicknames" onClick={() => setView('profile')} />
                <SettingsRow icon={<PaletteIcon size={18} />} title="Appearance" description={theme === 'paper' ? 'Paper & Ink' : 'Slate Dusk'} onClick={() => setView('appearance')} />
              </section>
              <section className="settings-group" aria-label="Security and devices">
                <p className="settings-group__label">Security & devices</p>
                <SettingsRow icon={<ShieldIcon size={18} />} title="Security" description="Your identity and contact verification" onClick={() => setView('verification')} />
                <SettingsRow icon={<LockIcon size={18} />} title="Devices" description="Review and approve devices" onClick={() => setView('devices')} />
                <SettingsRow icon={<ShieldIcon size={18} />} title="Privacy" description="Conversation and device privacy" onClick={() => setView('privacy')} />
                <SettingsRow icon={<NetworkIcon size={18} />} title="Connection" description="Connection status for this conversation" onClick={() => setView('network')} />
              </section>
              <section className="settings-group" aria-label="Notifications and about">
                <p className="settings-group__label">Notifications & about</p>
                <SettingsRow icon={<BellIcon size={18} />} title="Notifications" description={privacyPreferences.notificationsEnabled ? 'Private alerts are on' : 'Notifications are off'} onClick={() => setView('notifications')} />
                <SettingsRow icon={<MicIcon size={18} />} title="Calls" description="Ringtone and media permissions" onClick={() => setView('calls')} />
                <SettingsRow icon={<InfoIcon size={18} />} title="About" description="K3NCRYPT · private communication" status="Private beta" />
              </section>
            </>
          )}

          {view === 'appearance' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Choose a feeling</h3><p>Appearance stays on this device and never changes how your conversations work.</p></div>
              <ThemeSwitcher />
            </section>
          )}

          {view === 'profile' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Your profile</h3><p>Your display name appears in your space on this device. Contact nicknames are also local to this device. Neither name is part of your cryptographic identity or proves who someone is.</p></div>
              <div className="unavailable-card profile-name-card">
                <label htmlFor="local-profile-name">Display name</label>
                <input id="local-profile-name" className="message-input" maxLength={40} value={profileNameDraft} disabled={accountState !== 'ready'} onChange={(event) => setProfileNameDraft(event.target.value)} />
                {accountState !== 'ready' && <p>Unlock your device vault to edit this name.</p>}
                <button className="btn btn--secondary" type="button" disabled={accountState !== 'ready' || !profileNameDraft.trim() || profileNameDraft.trim() === profileDisplayName} onClick={() => updateProfileDisplayName(profileNameDraft).catch(() => setVerificationError('Could not save your display name.'))}>Save display name</button>
                {verificationError && <p role="alert">{verificationError}</p>}
              </div>
            </section>
          )}

          {view === 'privacy' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Designed around your privacy</h3><p>{protocolMode === 'modern' ? 'Your modern contact uses a lasting identity on this device.' : 'Your current conversation uses its private invitation to protect messages in transit.'}</p></div>
              <div className="state-card state-card--positive"><ShieldIcon size={21} /><div><strong>Conversation protection is on</strong><p>{protocolMode === 'modern' ? 'Your identity and conversation state stay in your local encrypted vault.' : 'Sensitive invitation details stay in the link fragment and are not sent as a normal page request.'}</p></div></div>
              <div className="preference-list">
                <SettingsRow icon={<LockIcon size={17} />} title="App lock" description="Modern account data requires the local vault passphrase" status={protocolMode === 'modern' ? 'On' : 'Modern only'} />
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notification previews</strong><small>Show message content in system notifications</small></span><input type="checkbox" checked={privacyPreferences.notificationPreviews} onChange={(event) => updatePrivacyPreferences({ notificationPreviews: event.target.checked })} /></label>
                <label className="settings-row"><span className="settings-row__icon"><ShieldIcon size={17} /></span><span className="settings-row__copy"><strong>Blur sensitive content</strong><small>Reduce readable content when the app is in the background</small></span><input type="checkbox" checked={privacyPreferences.blurSensitiveContent} onChange={(event) => updatePrivacyPreferences({ blurSensitiveContent: event.target.checked })} /></label>
                <label className="settings-row"><span className="settings-row__icon"><ShieldIcon size={17} /></span><span className="settings-row__copy"><strong>Screen privacy</strong><small>Use supported native screen-capture protection</small></span><input type="checkbox" checked={privacyPreferences.screenPrivacy} onChange={(event) => updatePrivacyPreferences({ screenPrivacy: event.target.checked })} /></label>
                <SettingsRow icon={<InfoIcon size={17} />} title="Link previews" description="No link previews are generated" status="Off" />
                <label className="settings-row"><span className="settings-row__icon"><StorageIcon size={17} /></span><span className="settings-row__copy"><strong>Media auto-download</strong><small>Open protected media only when you choose</small></span><input type="checkbox" checked={privacyPreferences.mediaAutoDownload} onChange={(event) => updatePrivacyPreferences({ mediaAutoDownload: event.target.checked })} /></label>
                <SettingsRow icon={<ShieldIcon size={17} />} title="Analytics" description="No usage analytics are sent" status="Off" />
                <SettingsRow icon={<MicIcon size={17} />} title="Microphone permission" description="Requested only from a call or voice-note action" status={permissionStatus.microphone} />
                <SettingsRow icon={<InfoIcon size={17} />} title="Camera permission" description="No background camera capture" status={permissionStatus.camera} />
                <button className="btn btn--secondary" type="button" onClick={() => refreshPermissionStatus()}>Refresh permissions</button>
              </div>
              {privacyPreferences.screenPrivacy && <p className="detail-note">Screen privacy is a preference for supported native hosts. This browser client cannot guarantee screenshot prevention.</p>}
            </section>
          )}

          {view === 'notifications' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Private notifications</h3><p>By default, alerts identify K3NCRYPT and the event, never the sender or message content.</p></div>
              <div className="preference-list">
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notifications</strong><small>Show new message, call, and security event alerts</small></span><input type="checkbox" checked={privacyPreferences.notificationsEnabled} onChange={(event) => updatePrivacyPreferences({ notificationsEnabled: event.target.checked })} /></label>
                <label className="settings-row"><span className="settings-row__icon"><LockIcon size={17} /></span><span className="settings-row__copy"><strong>Message previews</strong><small>Show content only if you explicitly choose to</small></span><input type="checkbox" checked={privacyPreferences.notificationPreviews} disabled={!privacyPreferences.notificationsEnabled} onChange={(event) => updatePrivacyPreferences({ notificationPreviews: event.target.checked })} /></label>
                {channelHash && <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Mute this conversation</strong><small>Keep this conversation out of system notifications</small></span><input type="checkbox" checked={privacyPreferences.mutedConversations.includes(channelHash)} onChange={(event) => updatePrivacyPreferences({ mutedConversations: event.target.checked ? [...privacyPreferences.mutedConversations, channelHash] : privacyPreferences.mutedConversations.filter((id) => id !== channelHash) })} /></label>}
              </div>
            </section>
          )}

          {view === 'calls' && (
            <section className="settings-detail"><div className="detail-intro"><h3>Calls</h3><p>Microphone and camera access begins only after you accept or start a call.</p></div><div className="preference-list"><label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Incoming call ringtone</strong><small>Play a local ringtone while an incoming call is waiting</small></span><input type="checkbox" checked={privacyPreferences.ringtoneEnabled} onChange={(event) => updatePrivacyPreferences({ ringtoneEnabled: event.target.checked })} /></label><SettingsRow icon={<MicIcon size={17} />} title="Microphone" description="Requested only after an explicit call action" status={permissionStatus.microphone} /><SettingsRow icon={<InfoIcon size={17} />} title="Camera" description="Requested only after an explicit video action" status={permissionStatus.camera} /></div></section>
          )}

          {view === 'network' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>A simple connection</h3><p>The K3NCRYPT service helps trusted contacts reach one another while your messages remain protected.</p></div>
              <div className="network-status">
                <span className={`network-pulse ${isConnected ? 'online' : ''}`} />
                <div><strong>{isConnected ? 'Secure conversation connected' : 'Waiting for your contact'}</strong><p>Connection for this conversation</p></div>
                <StatusPill tone={isConnected ? 'positive' : 'quiet'}>{isConnected ? 'Online' : 'Waiting'}</StatusPill>
              </div>
              <div className="network-status"><span className={`network-pulse ${syncStatus === 'ready' ? 'online' : ''}`} /><div><strong>Service connection</strong><p>Service availability for this device</p></div><StatusPill tone={syncStatus === 'ready' ? 'positive' : 'quiet'}>{syncStatus === 'ready' ? 'Ready' : 'Waiting'}</StatusPill></div>
              <p className="detail-note">This beta uses the configured K3NCRYPT service to connect trusted contacts.</p>
            </section>
          )}

          {view === 'verification' && (
            <section className="settings-detail verification-view">
              <div className="verification-mark"><ShieldIcon size={30} /></div>
              <h3>Security identity</h3>
              <p>{copy.verification.description}</p>
              {protocolMode === 'modern' && ownFingerprint ? <div className="unavailable-card security-details-card">
                <strong>This device identity</strong>
                <p>This identity belongs to this device. It is separate from your profile name.</p>
                <strong>Your security code</strong><code className="verification-code">{ownFingerprint}</code>
                <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(ownFingerprint)}>Copy your code</button>
                <strong>Verification code</strong>
                <p>Show this temporary code to your contact so you can compare that you have the right person. It is not saved.</p>
                <textarea className="verification-qr-payload" aria-label="Your verification QR payload" readOnly value={encodeVerificationQrPayload(ownFingerprint)} />
                <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(encodeVerificationQrPayload(ownFingerprint))}>Copy verification code</button>
                {contactIdentity ? <>
                  <strong>Verified contacts</strong>
                  <StatusPill tone={contactIdentity.verification === 'verified' && contactIdentity.changeStatus === 'unchanged' ? 'positive' : 'quiet'}>{contactIdentity.changeStatus === 'changed-pending-review' ? 'Identity changed · review required' : contactIdentity.verification === 'verified' ? 'Verified' : 'Unverified'}</StatusPill>
                      <button className="btn btn--secondary" type="button" onClick={() => unverifyContact().catch(() => setVerificationError('Could not reset verification.'))}>Mark unverified</button>
                  <strong>Contact security code</strong><code className="verification-code">{contactIdentity.identityId}</code>
                  <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(contactIdentity.identityId)}>Copy contact code</button>
                  {contactIdentity.changeStatus === 'changed-pending-review' ? <>
                    <p role="alert">K3NCRYPT can’t confirm this is the same person or device anymore. Compare the new security code with them using another trusted way before you verify again.</p>
                    <strong>Previous security code</strong><code className="verification-code">{contactIdentity.identityId}</code>
                    <strong>New security code</strong><code className="verification-code">{contactIdentity.pendingIdentity?.identityId ?? 'Unavailable'}</code>
                    <div className="verification-actions">
                    <button className="btn btn--secondary" type="button" onClick={() => { setComparisonConfirmed(false); setRecoveryNotice('Compare the new fingerprint through another trusted channel before accepting it.'); }}>Verify again</button>
                      <button className="btn btn--secondary" type="button" onClick={() => setRecoveryNotice('Change rejected. This conversation remains unverified.')}>Reject change</button>
                      <button className="btn btn--danger" type="button" onClick={() => deleteChannel().catch(() => setVerificationError('Could not block this conversation.'))}>Block conversation</button>
                    </div>
                    <label><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /> I compared the new fingerprint with my contact</label>
                    <button className="btn btn--secondary" type="button" disabled={!comparisonConfirmed} onClick={() => acceptChangedIdentity().catch(() => setVerificationError('Could not accept this identity change.'))}>Accept new identity after review</button>
                  </> : contactIdentity.verification !== 'verified' ? <>
                    <p>Compare this security code with your contact using another trusted way before marking them verified.</p>
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
                    <label><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /> I compared the security codes with my contact</label>
                    <button className="btn btn--primary" type="button" disabled={!comparisonConfirmed} onClick={() => {
                      verifyContact().then(() => { setComparisonConfirmed(false); setVerificationError(''); }).catch(() => setVerificationError('Could not save verification. Try again.'));
                    }}>Mark as verified</button>
                    {qrMatch && <p role="status">The code matches this contact. Continue only after confirming it with them.</p>}
                  </> : <>
                    <p>You marked this contact as verified on this device.</p>
                    {sessionHealth === 'unhealthy' && <>
                      <p role="alert">This conversation needs a security reset. Compare this contact’s security code using another trusted way before continuing. Your saved identity, verification and messages stay on this device.</p>
                      <label><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /> I compared this security code with my contact again</label>
                      <button className="btn btn--secondary" type="button" disabled={!comparisonConfirmed} onClick={() => {
                        prepareVerifiedSessionRenewal().then(() => { setComparisonConfirmed(false); setVerificationError(''); }).catch(() => setVerificationError('Session renewal was not prepared. Recheck the contact identity and device trust.'));
                      }}>Prepare verified session renewal</button>
                    </>}
                    {sessionHealth === 'renewal-pending' && <p role="status">Ask your contact to prepare verified session renewal on their device, then send one text message. Calls remain paused until that message is accepted.</p>}
                  </>}
                </> : <p>{channelHash ? 'Identity details are not available for this conversation yet.' : 'Choose a conversation to review its identity and verification status.'}</p>}
                {recoveryNotice && <p role="status">{recoveryNotice}</p>}
                {verificationError && <p role="alert">{verificationError}</p>}
              </div> : <div className="unavailable-card"><StatusPill tone="quiet">Not available in this conversation</StatusPill><p>Security code verification is available for contacts added through a supported invitation.</p></div>}
            </section>
          )}

          {view === 'devices' && (
            <section className="settings-detail verification-view">
              <div className="detail-intro"><h3>Add another device</h3><p>Each device has its own secure identity. The new device prepares its own identity, then an existing trusted device approves it. This does not sign the new device into a shared identity.</p></div>
              <ol className="device-enrollment-steps">
                <li><strong>Open K3NCRYPT on the new device.</strong><span>Choose the option to set up another device.</span></li>
                <li><strong>Request approval.</strong><span>On this trusted device, enter the new device’s public enrollment details under Advanced details.</span></li>
                <li><strong>Approve and confirm.</strong><span>Review the request here, then complete confirmation on the new device.</span></li>
              </ol>
              {protocolMode === 'modern' ? <div className="device-management" aria-label="Device management">
                <strong>Devices on this account</strong>
                <p>Only devices explicitly approved through the existing trust process become active.</p>
                {deviceLifecycleState?.list.devices.map((device) => <div className="network-status" key={device.deviceId}>
                  <div><strong>{device.deviceId === userId ? 'This device' : 'Approved device'}</strong><p>{device.state === 'revoked' ? 'Removed' : device.state === 'active' ? 'Active' : 'Approval pending'}</p></div>
                  {device.deviceId !== userId && device.state !== 'revoked' && <button className="btn btn--danger" type="button" onClick={() => { if (window.confirm('Confirm removing this device from your private device list?')) revokeDevice(device.deviceId).catch(() => setVerificationError('Could not revoke this device.')); }}>Revoke</button>}
                </div>)}
                {pendingDeviceEnrollment && <div className="state-card state-card--positive"><strong>A device is waiting for approval</strong><div className="verification-actions"><button className="btn btn--primary" type="button" onClick={() => approveDeviceEnrollment().catch(() => setVerificationError('Could not approve this device.'))}>Approve</button><button className="btn btn--secondary" type="button" onClick={() => rejectDeviceEnrollment().catch(() => setVerificationError('Could not reject this device.'))}>Reject</button></div></div>}
                {pendingDeviceApproval && <div className="state-card state-card--positive"><strong>Device approval received</strong><p>Finish the approval on this device to activate its separate identity.</p><button className="btn btn--primary" type="button" onClick={() => confirmDeviceEnrollment().then(() => setRecoveryNotice('This independent device is now active on the account.')).catch(() => setVerificationError('Could not confirm device enrollment.'))}>Confirm on this device</button></div>}
                <details className="device-advanced-details">
                  <summary>Advanced details</summary>
                  <p>Use these public enrollment values only when following the existing device approval process.</p>
                  <label htmlFor="device-id-input">New device ID</label>
                  <input id="device-id-input" className="verification-qr-payload" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} placeholder="Public device identifier" />
                  <label htmlFor="device-identity-input">New public identity reference</label>
                  <input id="device-identity-input" className="verification-qr-payload" value={deviceIdentityInput} onChange={(event) => setDeviceIdentityInput(event.target.value)} placeholder="Public identity reference" />
                  <button className="btn btn--secondary" type="button" disabled={!deviceIdInput || !deviceIdentityInput} onClick={() => requestDeviceEnrollment(deviceIdInput, deviceIdentityInput, 'Olm-Curve25519+Ed25519').then(() => { setDeviceIdInput(''); setDeviceIdentityInput(''); setRecoveryNotice('Request sent over the encrypted conversation.'); }).catch(() => setVerificationError('Could not send the enrollment request.'))}>Request device approval</button>
                </details>
                {recoveryNotice && <p role="status">{recoveryNotice}</p>}
                {verificationError && <p role="alert">{verificationError}</p>}
              </div> : <div className="unavailable-card"><StatusPill tone="quiet">Devices unavailable</StatusPill><p>Device approval is available for contacts added through a supported invitation.</p></div>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
