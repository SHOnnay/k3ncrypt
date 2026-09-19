import React, { useEffect, useState } from 'react';
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
  const { channelHash, isConnected, protocolMode, ownFingerprint, contactIdentity, verifyContact } = useChat();
  const [comparisonConfirmed, setComparisonConfirmed] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const { theme } = useTheme();

  useEffect(() => {
    if (!isOpen) setView('settings');
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
                <SettingsRow icon={<LockIcon size={17} />} title="App lock" description="Unlock this app with a passphrase" status="Not available yet" disabled />
                <SettingsRow icon={<BellIcon size={17} />} title="Notification privacy" description="Hide message previews" status="Not available yet" disabled />
                <SettingsRow icon={<InfoIcon size={17} />} title="Link previews" description="No link previews are generated" status="Off" />
                <SettingsRow icon={<StorageIcon size={17} />} title="Media controls" description="Attachments are not available yet" status="Off" disabled />
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
                {contactIdentity ? <>
                  <StatusPill tone={contactIdentity.verification === 'verified' && contactIdentity.changeStatus === 'unchanged' ? 'positive' : 'quiet'}>{contactIdentity.changeStatus === 'changed-pending-review' ? 'Identity changed · review required' : contactIdentity.verification === 'verified' ? 'Verified' : 'Unverified'}</StatusPill>
                  <strong>Contact fingerprint</strong><code className="verification-code">{contactIdentity.identityId}</code>
                  <button className="btn btn--secondary" type="button" onClick={() => navigator.clipboard.writeText(contactIdentity.identityId)}>Copy contact fingerprint</button>
                  {contactIdentity.changeStatus === 'changed-pending-review' ? <p>This identity changed. Messages are paused until you review this contact in a future recovery flow.</p> : contactIdentity.verification !== 'verified' ? <>
                    <p>Compare this fingerprint with your contact through another trusted way before marking it verified.</p>
                    <label><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /> I compared the fingerprints with my contact</label>
                    <button className="btn btn--primary" type="button" disabled={!comparisonConfirmed} onClick={() => {
                      verifyContact().then(() => { setComparisonConfirmed(false); setVerificationError(''); }).catch(() => setVerificationError('Could not save verification. Try again.'));
                    }}>Mark as verified</button>
                  </> : <p>You marked this contact as verified on this device.</p>}
                </> : <p>Your contact will appear here after the first message.</p>}
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
