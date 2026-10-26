import React, { useEffect, useRef, useState } from 'react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { VerificationPanel } from './VerificationPanel';
import { deviceStateLabel, permissionLabel } from './panelPresentation';
import { useServiceReachability } from './useServiceReachability';
import { contactDisplayName } from '../../content/copy';
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
  UserIcon,
} from '../common/icons';
import { SettingsRow } from './SettingsRow';
import './SettingsPanel.css';
import { classifySafeDiagnostic, logSafeFailure, type SafeDiagnosticCode } from '../../product/safeDiagnostics';
import { SafeDiagnosticDetails } from '../common/SafeDiagnosticDetails';

type SettingsView = 'settings' | 'profile' | 'devices' | 'privacy' | 'notifications' | 'calls' | 'appearance' | 'network' | 'verification';

interface SettingsPanelProps {
  isOpen: boolean;
  initialView?: SettingsView;
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, initialView = 'settings', onClose }) => {
  const [view, setView] = useState<SettingsView>(initialView);
  const { channelHash, isConnected, protocolMode, ownFingerprint, contactIdentity, conversations, verifyContact, unverifyContact, acceptChangedIdentity, prepareVerifiedSessionRenewal, sessionHealth, deleteChannel, deviceLifecycleState, pendingDeviceEnrollment, pendingDeviceApproval, requestDeviceEnrollment, approveDeviceEnrollment, rejectDeviceEnrollment, confirmDeviceEnrollment, revokeDevice, privacyPreferences, updatePrivacyPreferences, permissionStatus, refreshPermissionStatus, syncStatus, profileDisplayName, updateProfileDisplayName, accountState, pendingConversation, conversationOpenError } = useChat();
  const [verificationError, setVerificationError] = useState('');
  const [verificationDiagnostic, setVerificationDiagnostic] = useState<SafeDiagnosticCode>();
  useEffect(() => { if (isOpen) setView(initialView); }, [initialView, isOpen]);
  const reportVerificationFailure = (error: unknown) => {
    const code = classifySafeDiagnostic('contact-authority', error);
    logSafeFailure('contact_authority_failed', code);
    setVerificationDiagnostic(code);
    setVerificationError('K3NCRYPT can’t confirm this contact right now.');
  };
  const [deviceIdInput, setDeviceIdInput] = useState('');
  const [deviceIdentityInput, setDeviceIdentityInput] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState(profileDisplayName);
  const { theme } = useTheme();
  const service = useServiceReachability(isOpen && view === 'network');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const deviceAction = useRef(false);
  const actionScope = useRef({ channelHash, ownFingerprint, accountState, isOpen, view });
  const currentScope = actionScope.current;
  if (currentScope.channelHash !== channelHash || currentScope.ownFingerprint !== ownFingerprint || currentScope.accountState !== accountState || currentScope.isOpen !== isOpen || currentScope.view !== view) actionScope.current = { channelHash, ownFingerprint, accountState, isOpen, view };
  const deviceEligible = accountState === 'ready' && protocolMode === 'modern' && !!ownFingerprint && !pendingConversation;
  const enrollmentEligible = deviceEligible && contactIdentity?.verification === 'verified' && contactIdentity.changeStatus === 'unchanged';
  const runDeviceAction = async (action: () => Promise<unknown>, failure: string) => {
    if (deviceAction.current || accountState !== 'ready' || protocolMode !== 'modern') return;
    const scope = actionScope.current;
    deviceAction.current = true; setDeviceBusy(true); setDeviceError('');
    try { await action(); }
    catch { if (actionScope.current === scope) setDeviceError(failure); }
    finally { deviceAction.current = false; setDeviceBusy(false); }
  };
  useEffect(() => { setDeviceError(''); setVerificationError(''); setVerificationDiagnostic(undefined); setDeviceIdInput(''); setDeviceIdentityInput(''); }, [channelHash, ownFingerprint, accountState, view, isOpen]);
  const notificationPermission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const descriptor = conversations.find(entry => entry.roomId === channelHash);
  const expectsIdentity = !!descriptor?.remoteIdentityCommitment || descriptor?.relationship === 'accepted' || descriptor?.bootstrapState === 'ESTABLISHED';
  const opening = pendingConversation !== undefined;
  const currentConversationError = conversationOpenError?.roomId === channelHash ? conversationOpenError : undefined;
  const unavailable = accountState !== 'ready' || !!currentConversationError || sessionHealth !== 'healthy' || contactIdentity?.changeStatus === 'changed-pending-review';
  const conversationReady = isConnected && (protocolMode !== 'modern' || (!!contactIdentity?.identityId && (!descriptor?.bootstrapState || descriptor.bootstrapState === 'ESTABLISHED')));
  const readiness = accountState !== 'ready' ? 'Unlock required' : opening ? 'Opening conversation' : !channelHash ? 'Choose a conversation' : unavailable ? 'Recovery needed' : conversationReady ? 'Encrypted session available' : 'Waiting for acceptance';
  const conversationExplanation = accountState !== 'ready' ? 'Unlock your vault to use this saved conversation. Its encrypted records are preserved.'
    : opening ? 'Opening the selected saved conversation. Its own authorization checks still apply.'
    : !channelHash ? 'Choose a saved conversation to check its readiness.'
    : contactIdentity?.changeStatus === 'changed-pending-review' ? 'The contact identity changed. Open Security and compare the new code through a trusted channel before accepting it.'
    : sessionHealth === 'renewal-pending' ? 'Verified session renewal is waiting for an authenticated message from your contact. Sending and calls remain paused until renewal completes.'
    : sessionHealth === 'unhealthy' ? 'This saved encrypted session needs verified renewal. Open Security for the existing recovery steps; identity and history are preserved.'
    : currentConversationError ? 'This saved conversation could not be reopened. Use its saved entry to retry. A service check cannot restore missing authorization.'
    : conversationReady ? 'A local encrypted session is available. This does not measure a live socket or remote presence.'
    : 'An accepted encrypted introduction is needed before this conversation is ready.';
  const serviceLabel = { unchecked: 'Not checked', checking: 'Checking…', reachable: 'Reachable', 'not-ready': 'Not ready', unavailable: 'Unreachable', offline: 'Browser offline' }[service.status];

  useEffect(() => {
    setProfileNameDraft(profileDisplayName);
  }, [profileDisplayName]);

  useEffect(() => {
    if (!isOpen) {
      setView('settings');

    }
  }, [isOpen]);

  const panelRef = useRef<HTMLElement>(null);
  useModalKeyboard(isOpen, panelRef, onClose);
  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector('.settings-panel__body')?.scrollTo({ top: 0 });
    panelRef.current?.focus();
  }, [view, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="settings-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="settings-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={viewTitles[view]}>
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
              <div className="detail-intro"><h3>Your profile</h3><p>Your display name is shared only through encrypted conversations with your contacts. Contact nicknames stay on this device. Neither name is part of your cryptographic identity or proves who someone is.</p></div>
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
              <div className="detail-intro"><h3>Your privacy choices</h3><p>Preferences apply in this browser. Fixed protections and browser permissions are shown separately.</p></div>
              <section className="panel-group" aria-labelledby="protection-title"><h4 id="protection-title">App protection</h4><div className="preference-list">
                <SettingsRow icon={<LockIcon size={17} />} title="Encrypted vault" description="Account keys and saved messages require your vault passphrase. This protection cannot be switched off here." status={accountState === 'ready' ? 'Unlocked' : accountState === 'locked' ? 'Locked' : 'Not open'} />
                <SettingsRow icon={<ShieldIcon size={17} />} title="End-to-end encryption" description="Private message contents are encrypted by the clients. Verification is a separate identity check." status="Built in" />
              </div></section>
              <section className="panel-group" aria-labelledby="alerts-title"><h4 id="alerts-title">Notifications and previews</h4><div className="preference-list">
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notifications</strong><small>Allow this open app to show alerts when browser permission is granted</small></span><input type="checkbox" checked={privacyPreferences.notificationsEnabled} onChange={event => updatePrivacyPreferences({ notificationsEnabled: event.target.checked })} /></label>
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notification previews</strong><small>Include message text in permitted system alerts</small></span><input type="checkbox" checked={privacyPreferences.notificationPreviews} disabled={!privacyPreferences.notificationsEnabled} onChange={event => updatePrivacyPreferences({ notificationPreviews: event.target.checked })} /></label>
                <SettingsRow icon={<BellIcon size={17} />} title="Browser notification permission" description="Change this in your browser’s site settings. Enabling alerts here does not grant browser permission or wake a closed app." status={permissionLabel(notificationPermission)} />
              </div></section>
              <section className="panel-group" aria-labelledby="screen-title"><h4 id="screen-title">Screen privacy</h4><div className="preference-list">
                <label className="settings-row"><span className="settings-row__icon"><ShieldIcon size={17} /></span><span className="settings-row__copy"><strong>Blur sensitive content</strong><small>Blur the app when its tab is hidden. This does not lock the vault or prevent screenshots.</small></span><input type="checkbox" checked={privacyPreferences.blurSensitiveContent} onChange={event => updatePrivacyPreferences({ blurSensitiveContent: event.target.checked })} /></label>
                <SettingsRow icon={<InfoIcon size={17} />} title="Screenshot prevention" description="Web browsers cannot guarantee screen-capture protection." status="Unavailable" />
              </div></section>
              <section className="panel-group" aria-labelledby="permissions-title"><h4 id="permissions-title">Browser permissions</h4><div className="preference-list">
                <SettingsRow icon={<MicIcon size={17} />} title="Microphone permission" description="Requested when you start or answer a call, or explicitly record audio" status={permissionLabel(permissionStatus.microphone)} />
                <SettingsRow icon={<InfoIcon size={17} />} title="Camera permission" description="Requested for video calling or an explicit verification QR scan" status={permissionLabel(permissionStatus.camera)} />
              </div><p className="detail-note">Not reported means the browser did not expose a permission state. Use its site settings to change access.</p><button className="btn btn--secondary" type="button" onClick={() => void refreshPermissionStatus()}>Refresh permissions</button></section>
              <section className="panel-group" aria-labelledby="data-title"><h4 id="data-title">Data and external connections</h4><div className="preference-list">
                <SettingsRow icon={<InfoIcon size={17} />} title="Link previews" description="This app does not fetch link previews." status="Off" />
                <SettingsRow icon={<ShieldIcon size={17} />} title="Usage analytics" description="This app does not send usage analytics. The service still handles connection and delivery requests." status="Off" />
                <SettingsRow icon={<LockIcon size={17} />} title="Protected files" description="Download files explicitly. No automatic media download is offered." status="Manual" />
              </div></section>
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
            <section className="settings-detail"><div className="detail-intro"><h3>Calls</h3><p>Calls use your microphone or camera only after an explicit call action. QR scanning and audio recording can also request media access.</p></div><div className="preference-list"><label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Incoming call ringtone</strong><small>Play a local ringtone while an incoming call is waiting</small></span><input type="checkbox" checked={privacyPreferences.ringtoneEnabled} onChange={(event) => updatePrivacyPreferences({ ringtoneEnabled: event.target.checked })} /></label><SettingsRow icon={<MicIcon size={17} />} title="Microphone" description="Requested only after an explicit call action" status={permissionLabel(permissionStatus.microphone)} /><SettingsRow icon={<InfoIcon size={17} />} title="Camera" description="Requested only after an explicit video action" status={permissionLabel(permissionStatus.camera)} /></div></section>
          )}

          {view === 'network' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Connection and readiness</h3><p>The service, encrypted session and device authorization are different checks. None of them proves your contact is online.</p></div>
              <div className="network-status" role="status"><span className={`network-pulse ${service.status === 'reachable' ? 'online' : ''}`} /><div><strong>Service reachability</strong><p>{service.status === 'reachable' ? 'The service answered this panel’s latest readiness check.' : service.status === 'checking' ? 'Checking the configured service, for up to five seconds.' : service.status === 'not-ready' ? 'The service responded but did not report ready. Try again shortly.' : service.status === 'offline' ? 'Your browser reports no network connection.' : 'No successful current readiness check. Check your connection and retry.'}</p><StatusPill tone={service.status === 'reachable' ? 'positive' : 'quiet'}>{serviceLabel}</StatusPill></div></div>
              <button className="btn btn--secondary" type="button" disabled={service.status === 'checking'} onClick={service.check}>Check service again</button>
              <div className="network-status"><span className={`network-pulse ${!unavailable && conversationReady && !opening ? 'online' : ''}`} /><div><strong>Current conversation</strong><p>{conversationExplanation}</p><StatusPill tone={!unavailable && conversationReady && !opening ? 'positive' : 'quiet'}>{readiness}</StatusPill></div></div>
              {protocolMode === 'modern' && <div className="network-status"><span className={`network-pulse ${syncStatus === 'ready' && accountState === 'ready' ? 'online' : ''}`} /><div><strong>Last device authorization check</strong><p>{syncStatus === 'ready' && accountState === 'ready' ? 'The selected session’s last device-trust check passed. Operations still recheck authorization.' : syncStatus === 'recovering' ? 'Session authorization is recovering. Completion is not yet confirmed.' : 'The last session check did not confirm device authorization. Each operation checks current authorization again; this is not a service outage or a new revocation decision.'}</p><StatusPill tone={syncStatus === 'ready' && accountState === 'ready' ? 'positive' : 'quiet'}>{accountState !== 'ready' ? 'Unlock required' : syncStatus === 'ready' ? 'Confirmed' : syncStatus === 'recovering' ? 'Recovering' : 'Not confirmed'}</StatusPill></div></div>}
              <div className="state-card"><div><strong>Sending and delivery</strong><p>{!unavailable && conversationReady && !opening ? 'You can try sending in this conversation; the operation must still pass authorization and service checks.' : 'Resolve the conversation’s readiness state before retrying. A connection check cannot authorize it.'} Sent means the relay accepted an encrypted message. Delivered requires the recipient’s authenticated acknowledgment. A contact can be offline while a message waits at the relay within its retention limits.</p></div></div>
              <details className="panel-details"><summary>Advanced details</summary><p>Service reachability is a read-only HTTP readiness check, not a persistent socket monitor. Conversation readiness comes from local session establishment; device authorization comes from the selected session’s trust/recovery state. Remote presence and mailbox delivery are not inferred.</p></details>
            </section>
          )}

          {view === 'verification' && <section className="settings-detail verification-view">
            {protocolMode === 'modern' && accountState === 'ready' && ownFingerprint ? <VerificationPanel
              label={(() => { const item = conversations.find((entry) => entry.roomId === channelHash); return contactDisplayName(item?.label, item?.roomId, item?.remoteDisplayName, item?.localNickname); })()}
              key={`${channelHash}:${ownFingerprint}`} ownFingerprint={ownFingerprint} contact={contactIdentity} sessionHealth={sessionHealth} availability={unavailable || expectsIdentity ? 'unavailable' : 'waiting'}
              verify={verifyContact} unverify={unverifyContact} acceptChange={acceptChangedIdentity} renew={prepareVerifiedSessionRenewal} block={deleteChannel}
              onError={reportVerificationFailure} onDone={onClose} /> : <div className="unavailable-card"><strong>Open a contact to review security</strong><p>Unlock your vault, then choose a saved private conversation. Verification needs both authenticated identities; no confirmation is available here yet.</p></div>}
            {verificationError && <><p role="alert">{verificationError}</p><SafeDiagnosticDetails code={verificationDiagnostic} /></>}
          </section>}

          {view === 'devices' && (
            <section className="settings-detail verification-view">
              <div className="detail-intro"><h3>Devices in this account</h3><p>Review the device list available through this encrypted session. Device approval does not copy your vault, contacts or history to another device.</p></div>
              {protocolMode === 'modern' && accountState === 'ready' ? <div className="device-management" aria-label="Device management">
                {!deviceLifecycleState?.list.devices.length && <div className="unavailable-card"><strong>Device list unavailable</strong><p>Unlock and reopen an authorized conversation to load its device list. An unavailable list does not mean devices were removed.</p></div>}
                {deviceLifecycleState?.list.devices.map((device) => {
                  // userId is a routing address, not a device ID. Match the complete local identity instead.
                  const current = !!ownFingerprint && device.publicIdentityReference === ownFingerprint;
                  const name = current ? 'This device' : device.label || `Device · ${device.deviceId.slice(-6)}`;
                  return <article className="device-card" key={device.deviceId} aria-label={name}>
                    <div className="device-card__copy"><strong>{name}</strong><StatusPill tone={device.state === 'active' ? 'positive' : 'quiet'}>{deviceStateLabel(device.state)}</StatusPill><p>{device.state === 'revoked' ? 'No longer authorized. This entry is retained as a record.' : current ? 'The identity currently unlocked in this browser. Self-revocation is not offered here.' : device.state === 'active' ? 'Explicitly approved in this device list.' : 'Not active until the existing approval and confirmation process completes.'}</p>
                      <details><summary>Device details</summary><dl><dt>Device ID</dt><dd>{device.deviceId}</dd><dt>Public identity reference</dt><dd>{device.publicIdentityReference}</dd></dl></details>
                    </div>
                    {!current && device.state !== 'revoked' && <button className="btn btn--danger" type="button" disabled={deviceBusy || !deviceEligible} onClick={() => { if (window.confirm(`Revoke ${name}? This removes its authorization in this account device list and may interrupt its access. It does not erase that device’s saved data. This browser’s identity is not being revoked.`)) void runDeviceAction(() => revokeDevice(device.deviceId), 'Could not confirm revocation. The displayed device state has not been changed.'); }}>Revoke</button>}
                  </article>;
                })}
                {!deviceEligible && <p className="detail-note">Unlock and open a saved private conversation before making device changes. Every operation checks current authorization.</p>}
                <div className="state-card"><div><strong>Add another device</strong><p>Guided device setup is not available in this Web beta. Advanced approval requires a supported target device and its matching verified identity. A separately registered account is not automatically a linked device. There is no automatic account or history synchronization.</p></div></div>
                {pendingDeviceEnrollment && <div className="state-card state-card--positive"><div><strong>A device is waiting for approval</strong><p>Review the request before choosing Approve.</p><dl className="device-request-details"><dt>Requested device</dt><dd>{pendingDeviceEnrollment.requestedDeviceId}</dd><dt>Public identity</dt><dd>{pendingDeviceEnrollment.requestedPublicIdentityReference}</dd></dl></div><div className="verification-actions"><button className="btn btn--primary" type="button" disabled={deviceBusy || !deviceEligible} onClick={() => { if (window.confirm('Approve the pending device only if you recognize its public identity and requested device ID shown below. Continue?')) void runDeviceAction(approveDeviceEnrollment, 'Could not confirm device approval.'); }}>Approve</button><button className="btn btn--secondary" type="button" disabled={deviceBusy || accountState !== 'ready'} onClick={() => void runDeviceAction(rejectDeviceEnrollment, 'Could not reject this device.')}>Reject</button></div></div>}
                {pendingDeviceApproval && <div className="state-card state-card--positive"><strong>Device approval received</strong><p>Finish the approval on this device to activate its separate identity.</p><button className="btn btn--primary" type="button" disabled={deviceBusy || accountState !== 'ready'} onClick={() => void runDeviceAction(confirmDeviceEnrollment, 'Could not confirm device enrollment.')}>Confirm on this device</button></div>}
                <details className="device-advanced-details">
                  <summary>Advanced details</summary>
                  <p>Only approve a device you recognize. The existing protocol checks the complete target identity against the verified contact; arbitrary public values cannot enroll a device.</p>
                  <label htmlFor="device-id-input">New device ID</label>
                  <input id="device-id-input" className="verification-qr-payload" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} placeholder="Public device identifier" />
                  <label htmlFor="device-identity-input">New public identity reference</label>
                  <input id="device-identity-input" className="verification-qr-payload" value={deviceIdentityInput} onChange={(event) => setDeviceIdentityInput(event.target.value)} placeholder="Public identity reference" />
                  <button className="btn btn--secondary" type="button" disabled={deviceBusy || !enrollmentEligible || !deviceIdInput.trim() || !deviceIdentityInput.trim()} onClick={() => { if (window.confirm('Request approval for exactly the public device ID and verified identity entered above? This can authorize that device after confirmation.')) void runDeviceAction(() => requestDeviceEnrollment(deviceIdInput.trim(), deviceIdentityInput.trim(), 'Olm-Curve25519+Ed25519'), 'Could not confirm the device approval request. Check the public values and session authorization.'); }}>Request device approval</button>
                </details>
                {deviceBusy && <p role="status">Waiting for authenticated device confirmation…</p>}{deviceError && <p role="alert">{deviceError}</p>}
                {verificationError && <p role="alert">{verificationError}</p>}
              </div> : <div className="unavailable-card"><StatusPill tone="quiet">{accountState !== 'ready' ? 'Unlock required' : 'Devices unavailable'}</StatusPill><p>Unlock your vault and open a supported private conversation to review its device list.</p></div>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
