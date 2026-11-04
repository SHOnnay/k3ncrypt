import { deriveSecurityVisibility } from '../../product/securityVisibility';
import { connectionHelperProvider } from '../../calls/connectionHelper';
import { lastCallFailure } from '../../calls/callFailureCode';
import { LocalDataStatus } from '../AppShell/LocalDataStatus';
import { conversationStateCopy } from '../../product/conversationEligibility';
import { serverCopy } from '../../content/checkCopy';
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

type SettingsView = 'settings' | 'profile' | 'devices' | 'privacy' | 'notifications' | 'calls' | 'appearance' | 'network' | 'verification' | 'about' | 'advanced';

interface SettingsPanelProps {
  isOpen: boolean;
  initialView?: SettingsView;
  onClose: () => void;
}

const viewTitles: Record<SettingsView, string> = {
  settings: 'Settings',
  advanced: 'Advanced',
  profile: 'Profile',
  devices: 'Devices',
  privacy: 'Privacy',
  notifications: 'Notifications',
  calls: 'Calls',
  appearance: 'Appearance',
  network: 'Connection',
  about: 'About security',
  verification: 'Security',
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, initialView = 'settings', onClose }) => {
  const [view, setView] = useState<SettingsView>(initialView);
  const { channelHash, isConnected, protocolMode, ownFingerprint, contactIdentity, conversations, verifyContact, unverifyContact, acceptChangedIdentity, prepareVerifiedSessionRenewal, sessionHealth, deleteChannel, deviceLifecycleState, pendingDeviceEnrollment, pendingDeviceApproval, requestDeviceEnrollment, approveDeviceEnrollment, rejectDeviceEnrollment, confirmDeviceEnrollment, revokeDevice, privacyPreferences, updatePrivacyPreferences, permissionStatus, refreshPermissionStatus, syncStatus, profileDisplayName, updateProfileDisplayName, accountState, pendingConversation, conversationOpenError, unavailableConversations = [] } = useChat();
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
  const readiness = accountState !== 'ready' ? 'Unlock required' : opening ? 'Opening conversation' : !channelHash ? 'Choose a conversation' : unavailable ? 'Recovery needed' : conversationReady ? 'Secure connection ready' : 'Waiting for acceptance';
  const conversationExplanation = accountState !== 'ready' ? 'Unlock this device to use this chat. Its messages are still saved.'
    : opening ? 'Opening this chat…'
    : !channelHash ? 'Open a chat to see how it’s connected.'
    : contactIdentity?.changeStatus === 'changed-pending-review' ? 'Their security number changed. Check again before sharing files or calling.'
    : sessionHealth === 'renewal-pending' ? 'Waiting for your contact to confirm the secure connection update. Sending and calls are paused until then.'
    : sessionHealth === 'unhealthy' ? 'This chat’s secure connection needs renewing. Open Security to renew it; your messages are kept.'
    : currentConversationError ? 'This chat couldn’t reopen. Open it from your chat list to try again.'
    : conversationReady ? 'This chat’s secure connection is ready on this device. It doesn’t show whether your contact is online.'
    : 'An accepted encrypted introduction is needed before this conversation is ready.';
  const serviceLabel = { unchecked: 'Not checked', checking: serverCopy.checking, reachable: serverCopy.reachable, 'not-ready': serverCopy.notReachable, unavailable: serverCopy.notReachable, offline: 'You’re offline' }[service.status];

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
                <div><strong>{profileDisplayName}</strong><p>{protocolMode === 'modern' ? 'Your private space is on this device.' : 'Set up your private space to talk with your contacts.'}</p></div>
                <StatusPill tone="quiet">Local</StatusPill>
              </div>
              <section className="settings-group" aria-label="Personal settings">
                <p className="settings-group__label">Personal</p>
                <SettingsRow icon={<UserIcon size={18} />} title="Profile" description="Your name and local contact nicknames" onClick={() => setView('profile')} />
                <SettingsRow icon={<PaletteIcon size={18} />} title="Appearance" description={theme === 'paper' ? 'Paper & Ink' : 'Slate Dusk'} onClick={() => setView('appearance')} />
              </section>
              <section className="settings-group" aria-label="Security and devices">
                <p className="settings-group__label">Security & devices</p>
                <SettingsRow icon={<ShieldIcon size={18} />} title="Security" description="Your security number and checking contacts" onClick={() => setView('verification')} />
                <SettingsRow icon={<LockIcon size={18} />} title="Devices" description="Review and approve devices" onClick={() => setView('devices')} />
                <SettingsRow icon={<ShieldIcon size={18} />} title="Privacy" description="Conversation and device privacy" onClick={() => setView('privacy')} />
                <SettingsRow icon={<NetworkIcon size={18} />} title="Connection" description="K3NCRYPT server and this conversation" onClick={() => setView('network')} />
              </section>
              <section className="settings-group" aria-label="Notifications and about">
                <p className="settings-group__label">Notifications & about</p>
                <SettingsRow icon={<BellIcon size={18} />} title="Notifications" description={privacyPreferences.notificationsEnabled ? 'Private alerts are on' : 'Notifications are off'} onClick={() => setView('notifications')} />
                <SettingsRow icon={<MicIcon size={18} />} title="Calls" description="Ringtone and media permissions" onClick={() => setView('calls')} />
                <SettingsRow icon={<InfoIcon size={18} />} title="About security" description="What K3NCRYPT protects, and what it can’t" status="Private beta" onClick={() => setView('about')} />
                <SettingsRow icon={<InfoIcon size={18} />} title="Advanced" description="Technical details for troubleshooting" onClick={() => setView('advanced')} />
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
              <div className="detail-intro"><h3>Your profile</h3><p>Your display name is shared only through encrypted conversations with your contacts. Contact nicknames stay on this device. Names can be copied by anyone; only checking shows it’s really them.</p></div>
              <div className="unavailable-card profile-name-card">
                <label htmlFor="local-profile-name">Display name</label>
                <input id="local-profile-name" className="message-input" maxLength={40} value={profileNameDraft} disabled={accountState !== 'ready'} onChange={(event) => setProfileNameDraft(event.target.value)} />
                {accountState !== 'ready' && <p>Unlock this device to edit your name.</p>}
                <button className="btn btn--secondary" type="button" disabled={accountState !== 'ready' || !profileNameDraft.trim() || profileNameDraft.trim() === profileDisplayName} onClick={() => updateProfileDisplayName(profileNameDraft).catch(() => setVerificationError('Could not save your display name.'))}>Save display name</button>
                {verificationError && <p role="alert">{verificationError}</p>}
              </div>
            </section>
          )}

          {view === 'privacy' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Your privacy choices</h3><p>Preferences apply in this browser. Fixed protections and browser permissions are shown separately.</p></div>
              <section className="panel-group" aria-labelledby="protection-title"><h4 id="protection-title">App protection</h4><div className="preference-list">
                <SettingsRow icon={<LockIcon size={17} />} title="Passphrase lock" description="Your keys and saved messages are locked with your passphrase. This can’t be turned off." status={accountState === 'ready' ? 'Unlocked' : accountState === 'locked' ? 'Locked' : 'Not open'} />
                <SettingsRow icon={<ShieldIcon size={17} />} title="End-to-end encryption" description="Messages are encrypted on your devices. Checking a contact is a separate step." status="Built in" />
              </div></section>
              <section className="panel-group" aria-labelledby="alerts-title"><h4 id="alerts-title">Notifications and previews</h4><div className="preference-list">
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notifications</strong><small>Allow this open app to show alerts when browser permission is granted</small></span><input type="checkbox" checked={privacyPreferences.notificationsEnabled} onChange={event => updatePrivacyPreferences({ notificationsEnabled: event.target.checked })} /></label>
                <label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Notification previews</strong><small>Include message text in permitted system alerts</small></span><input type="checkbox" checked={privacyPreferences.notificationPreviews} disabled={!privacyPreferences.notificationsEnabled} onChange={event => updatePrivacyPreferences({ notificationPreviews: event.target.checked })} /></label>
                <SettingsRow icon={<BellIcon size={17} />} title="Browser notification permission" description="Change this in your browser’s site settings. Enabling alerts here does not grant browser permission or wake a closed app." status={permissionLabel(notificationPermission)} />
              </div></section>
              <section className="panel-group" aria-labelledby="screen-title"><h4 id="screen-title">Screen privacy</h4><div className="preference-list">
                <label className="settings-row"><span className="settings-row__icon"><ShieldIcon size={17} /></span><span className="settings-row__copy"><strong>Blur sensitive content</strong><small>Blur the app when its tab is hidden. It doesn’t lock the app or prevent screenshots.</small></span><input type="checkbox" checked={privacyPreferences.blurSensitiveContent} onChange={event => updatePrivacyPreferences({ blurSensitiveContent: event.target.checked })} /></label>
                <SettingsRow icon={<InfoIcon size={17} />} title="Screenshot prevention" description="Web browsers cannot guarantee screen-capture protection." status="Unavailable" />
              </div></section>
              <section className="panel-group" aria-labelledby="permissions-title"><h4 id="permissions-title">Browser permissions</h4><div className="preference-list">
                <SettingsRow icon={<MicIcon size={17} />} title="Microphone permission" description="Requested when you start or answer a call, or explicitly record audio" status={permissionLabel(permissionStatus.microphone)} />
                <SettingsRow icon={<InfoIcon size={17} />} title="Camera permission" description="Asked for when you start a video call or scan a check code" status={permissionLabel(permissionStatus.camera)} />
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

          {view === 'advanced' && (
            <section className="settings-detail" aria-label="Advanced">
              <div className="detail-intro"><h3>Advanced</h3><p>Technical details for troubleshooting. Nothing here changes your chats or checks.</p></div>
              <h4>Chats that need attention</h4>
              {unavailableConversations.length === 0 ? <p>None.</p> : <ul className="advanced-diagnostics">{unavailableConversations.map((item, index) =>
                <li key={`${item.roomId ?? 'entry'}-${index}`}><strong>{item.label}</strong> <code>{item.code ?? item.state}</code><p>{conversationStateCopy(item)}</p></li>)}</ul>}
              <LocalDataStatus className="conversation-recovery conversation-recovery--advanced" />
              <h4>Last call problem</h4>
              {(() => { const failure = lastCallFailure(); return failure ? <p className="advanced-call-failure"><code>{failure.code}</code> at {failure.stage.replace('-', ' ')}, {new Date(failure.at).toLocaleTimeString()}</p> : <p>None since this page opened.</p>; })()}
              {channelHash && protocolMode === 'modern' && (() => {
                const visibility = deriveSecurityVisibility({ contact: contactIdentity, sessionHealth, protocol: protocolMode });
                return <><h4>This conversation</h4><dl className="advanced-security-details">
                  <div><dt>Check</dt><dd>{visibility.badgeLabel}</dd></div>
                  <div><dt>Security number</dt><dd>{visibility.identityChange === 'unchanged' ? 'No change' : visibility.identityChange === 'changed-pending-review' ? 'Changed' : 'Not available'}</dd></div>
                  <div><dt>Message path</dt><dd>{visibility.transport === 'relay' ? 'Relay' : 'Not available'}</dd></div>
                  <div><dt>Session</dt><dd>{visibility.session === 'healthy' ? 'Healthy' : visibility.session === 'unhealthy' ? 'Unavailable' : visibility.session === 'renewal-pending' ? 'Renewal pending' : 'Not available'}</dd></div>
                </dl><p>Relay acknowledgements are not signed peer receipts. They do not prove that a message was displayed or read.</p></>;
              })()}
            </section>
          )}

          {view === 'about' && (
            <section className="settings-detail about-security" aria-label="About security">
              <div className="detail-intro"><h3>About security</h3><p>Plain words about what K3NCRYPT protects, and what it can’t.</p></div>
              <h4>What is protected</h4>
              <p>Your messages, photos, files and calls are encrypted on your device. The K3NCRYPT server only passes along locked data it can’t read.</p>
              <p>Checking a contact protects you from someone in the middle pretending to be them.</p>
              <h4>What the web app can’t protect against</h4>
              <p>On the web, the app itself is sent to your browser by the K3NCRYPT server every time you open it. If someone broke into that server, they could send a changed app that reads your messages before they are encrypted. Checking your contacts would not show this.</p>
              <p>For the strongest protection, use the K3NCRYPT Android app. It is installed once and does not download its code every time you open it.</p>
              <h4>What the server can see</h4>
              <p>The server can see that two accounts talk, when, and roughly how much. It cannot see what you say or send. File details are deleted within a day of a transfer ending, and never kept longer than 7 days.</p>
            </section>
          )}

          {view === 'calls' && (
            <section className="settings-detail"><div className="detail-intro"><h3>Calls</h3><p>Calls use your microphone or camera only after an explicit call action. QR scanning and audio recording can also request media access.</p></div><div className="preference-list"><label className="settings-row"><span className="settings-row__icon"><BellIcon size={17} /></span><span className="settings-row__copy"><strong>Incoming call ringtone</strong><small>Play a local ringtone while an incoming call is waiting</small></span><input type="checkbox" checked={privacyPreferences.ringtoneEnabled} onChange={(event) => updatePrivacyPreferences({ ringtoneEnabled: event.target.checked })} /></label><label className="settings-row"><span className="settings-row__icon"><InfoIcon size={17} /></span><span className="settings-row__copy"><strong>Connection helper</strong><small>Helps calls connect when you and your contact are on different networks. When on, your device asks a public server ({connectionHelperProvider()}) for your internet address before a call. That server sees your IP address only: not who you call or anything you say. Off by default.</small></span><input type="checkbox" aria-label="Connection helper" checked={privacyPreferences.connectionHelper} onChange={(event) => updatePrivacyPreferences({ connectionHelper: event.target.checked })} /></label><SettingsRow icon={<MicIcon size={17} />} title="Microphone" description="Requested only after an explicit call action" status={permissionLabel(permissionStatus.microphone)} /><SettingsRow icon={<InfoIcon size={17} />} title="Camera" description="Requested only after an explicit video action" status={permissionLabel(permissionStatus.camera)} /></div></section>
          )}

          {view === 'network' && (
            <section className="settings-detail">
              <div className="detail-intro"><h3>Connection and readiness</h3><p>The server, this chat’s secure connection and this device’s approval are checked separately. None of them shows whether your contact is online.</p></div>
              <div className="network-status" role="status"><span className={`network-pulse ${service.status === 'reachable' ? 'online' : ''}`} /><div><strong>{serverCopy.title}: {serviceLabel}</strong><p>{service.status === 'reachable' ? 'The service answered this panel’s latest readiness check.' : service.status === 'checking' ? 'Checking the configured service, for up to five seconds.' : service.status === 'not-ready' ? 'The service responded but did not report ready. Try again shortly.' : service.status === 'offline' ? 'Your browser reports no network connection.' : 'No successful current readiness check. Check your connection and retry.'}</p><StatusPill tone={service.status === 'reachable' ? 'positive' : 'quiet'}>{serviceLabel}</StatusPill></div></div>
              <button className="btn btn--secondary" type="button" disabled={service.status === 'checking'} onClick={service.check}>Check the server again</button>
              <div className="network-status"><span className={`network-pulse ${!unavailable && conversationReady && !opening ? 'online' : ''}`} /><div><strong>Current conversation</strong><p>{conversationExplanation}</p><StatusPill tone={!unavailable && conversationReady && !opening ? 'positive' : 'quiet'}>{readiness}</StatusPill></div></div>
              {protocolMode === 'modern' && <div className="network-status"><span className={`network-pulse ${syncStatus === 'ready' && accountState === 'ready' ? 'online' : ''}`} /><div><strong>This device’s approval</strong><p>{syncStatus === 'ready' && accountState === 'ready' ? 'This device is approved for this chat.' : syncStatus === 'recovering' ? 'Checking this device’s approval…' : 'This device’s approval couldn’t be confirmed just now. Each send checks again; this isn’t an outage.'}</p><StatusPill tone={syncStatus === 'ready' && accountState === 'ready' ? 'positive' : 'quiet'}>{accountState !== 'ready' ? 'Unlock required' : syncStatus === 'ready' ? 'Confirmed' : syncStatus === 'recovering' ? 'Recovering' : 'Not confirmed'}</StatusPill></div></div>}
              <div className="state-card"><div><strong>Sending and delivery</strong><p>{!unavailable && conversationReady && !opening ? 'You can send in this chat.' : 'This chat isn’t ready to send yet. See the note above.'} Sent means the server has your encrypted message. Delivered means your contact’s device confirmed it. If your contact is offline, the message waits on the server for a limited time.</p></div></div>
              <details className="panel-details"><summary>Advanced details</summary><p>Service reachability is a read-only HTTP readiness check, not a persistent socket monitor. Conversation readiness comes from local session establishment; device authorization comes from the selected session’s trust/recovery state. Remote presence and mailbox delivery are not inferred.</p></details>
            </section>
          )}

          {view === 'verification' && <section className="settings-detail verification-view">
            {protocolMode === 'modern' && accountState === 'ready' && ownFingerprint ? <VerificationPanel
              label={(() => { const item = conversations.find((entry) => entry.roomId === channelHash); return contactDisplayName(item?.label, item?.roomId, item?.remoteDisplayName, item?.localNickname); })()}
              key={`${channelHash}:${ownFingerprint}`} ownFingerprint={ownFingerprint} contact={contactIdentity} sessionHealth={sessionHealth} availability={unavailable || expectsIdentity ? 'unavailable' : 'waiting'}
              verify={verifyContact} unverify={unverifyContact} acceptChange={acceptChangedIdentity} renew={prepareVerifiedSessionRenewal} block={deleteChannel}
              onError={reportVerificationFailure} onDone={onClose} /> : <div className="unavailable-card"><strong>Open a contact to review security</strong><p>Unlock this device and open a chat to check that contact.</p></div>}
            {verificationError && <><p role="alert">{verificationError}</p><SafeDiagnosticDetails code={verificationDiagnostic} /></>}
          </section>}

          {view === 'devices' && (
            <section className="settings-detail verification-view">
              <div className="detail-intro"><h3>Devices in this account</h3><p>Devices that can use your account. Approving a device doesn’t copy your chats or history to it.</p></div>
              {protocolMode === 'modern' && accountState === 'ready' ? <div className="device-management" aria-label="Device management">
                {!deviceLifecycleState?.list.devices.length && <div className="unavailable-card"><strong>Device list unavailable</strong><p>Unlock and reopen an authorized conversation to load its device list. An unavailable list does not mean devices were removed.</p></div>}
                {deviceLifecycleState?.list.devices.map((device) => {
                  // userId is a routing address, not a device ID. Match the complete local identity instead.
                  const current = !!ownFingerprint && device.publicIdentityReference === ownFingerprint;
                  const name = current ? 'This device' : device.label || `Device · ${device.deviceId.slice(-6)}`;
                  return <article className="device-card" key={device.deviceId} aria-label={name}>
                    <div className="device-card__copy"><strong>{name}</strong><StatusPill tone={device.state === 'active' ? 'positive' : 'quiet'}>{deviceStateLabel(device.state)}</StatusPill><p>{device.state === 'revoked' ? 'Removed. Kept here as a record.' : current ? 'This browser. You can’t remove the device you’re using from here.' : device.state === 'active' ? 'Approved.' : 'Waiting: approval isn’t finished yet.'}</p>
                      <details><summary>Device details</summary><dl><dt>Device ID</dt><dd>{device.deviceId}</dd><dt>Device security number</dt><dd>{device.publicIdentityReference}</dd></dl></details>
                    </div>
                    {!current && device.state !== 'revoked' && <button className="btn btn--danger" type="button" disabled={deviceBusy || !deviceEligible} onClick={() => { if (window.confirm(`Revoke ${name}? This removes its authorization in this account device list and may interrupt its access. It does not erase that device’s saved data. This browser’s identity is not being revoked.`)) void runDeviceAction(() => revokeDevice(device.deviceId), 'Could not confirm revocation. The displayed device state has not been changed.'); }}>Revoke</button>}
                  </article>;
                })}
                {!deviceEligible && <p className="detail-note">Unlock and open a chat before changing devices.</p>}
                <div className="state-card"><div><strong>Add another device</strong><p>Adding another device isn’t available in the web app yet. A second account you create elsewhere isn’t linked to this one, and chats don’t sync between them.</p></div></div>
                {pendingDeviceEnrollment && <div className="state-card state-card--positive"><div><strong>A device is waiting for approval</strong><p>Review the request before choosing Approve.</p><dl className="device-request-details"><dt>Requested device</dt><dd>{pendingDeviceEnrollment.requestedDeviceId}</dd><dt>Security number</dt><dd>{pendingDeviceEnrollment.requestedPublicIdentityReference}</dd></dl></div><div className="verification-actions"><button className="btn btn--primary" type="button" disabled={deviceBusy || !deviceEligible} onClick={() => { if (window.confirm('Approve this device only if you recognize it and its security number shown below. Continue?')) void runDeviceAction(approveDeviceEnrollment, 'Could not confirm device approval.'); }}>Approve</button><button className="btn btn--secondary" type="button" disabled={deviceBusy || accountState !== 'ready'} onClick={() => void runDeviceAction(rejectDeviceEnrollment, 'Could not reject this device.')}>Reject</button></div></div>}
                {pendingDeviceApproval && <div className="state-card state-card--positive"><strong>Device approval received</strong><p>Finish the approval on this device to start using it.</p><button className="btn btn--primary" type="button" disabled={deviceBusy || accountState !== 'ready'} onClick={() => void runDeviceAction(confirmDeviceEnrollment, 'Couldn’t finish the device approval.')}>Confirm on this device</button></div>}
                <details className="device-advanced-details">
                  <summary>Advanced details</summary>
                  <p>Only approve a device you recognize.</p>
                  <label htmlFor="device-id-input">New device ID</label>
                  <input id="device-id-input" className="verification-qr-payload" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} placeholder="Public device identifier" />
                  <label htmlFor="device-identity-input">New device’s security number</label>
                  <input id="device-identity-input" className="verification-qr-payload" value={deviceIdentityInput} onChange={(event) => setDeviceIdentityInput(event.target.value)} placeholder="Device security number" />
                  <button className="btn btn--secondary" type="button" disabled={deviceBusy || !enrollmentEligible || !deviceIdInput.trim() || !deviceIdentityInput.trim()} onClick={() => { if (window.confirm('Ask to approve the device shown above? It can use your account once you confirm.')) void runDeviceAction(() => requestDeviceEnrollment(deviceIdInput.trim(), deviceIdentityInput.trim(), 'Olm-Curve25519+Ed25519'), 'Couldn’t send the approval request. Check the device details and try again.'); }}>Request device approval</button>
                </details>
                {deviceBusy && <p role="status">Waiting for the other device to confirm…</p>}{deviceError && <p role="alert">{deviceError}</p>}
                {verificationError && <p role="alert">{verificationError}</p>}
              </div> : <div className="unavailable-card"><StatusPill tone="quiet">{accountState !== 'ready' ? 'Unlock required' : 'Devices unavailable'}</StatusPill><p>Unlock this device and open a chat to see your devices.</p></div>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
