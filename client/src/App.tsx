import { FileProvider } from './context/FileContext';
/**
 * Main App component
 */

import React, { useEffect, useMemo, useState } from 'react';
import { MediaMessageWorkflow } from '@chat-e2ee/service';
import { useChat } from './context/ChatContext';
import { SetupOverlay } from './components/SetupOverlay/SetupOverlay';
import { ChatContainer } from './components/ChatContainer/ChatContainer';
import { updateUrlInvite } from './utils/urlHash';
import { Sidebar } from './components/AppShell/Sidebar';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import './styles/global.css';
import { debugError } from './utils/debug';
import { MediaProvider } from './context/MediaContext';
import { HttpAttachmentGateway } from './media/HttpAttachmentGateway';
import { getRuntimeConfig } from './config/runtimeConfig';
import { WorkspaceSection } from './components/AppShell/WorkspaceSection';
import { CallOverlay } from './components/CallOverlay/CallOverlay';

const AppContent: React.FC = () => {
  const { initializeChat, joinChannel, openConversation, attachmentRequestHeaders, privacyPreferences } = useChat();
  const [showSetup, setShowSetup] = useState(true);
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [activeSection, setActiveSection] = useState<'chats' | 'contacts' | 'calls'>('chats');
  const [backgrounded, setBackgrounded] = useState(false);
  const mediaWorkflow = useMemo(() => new MediaMessageWorkflow(new HttpAttachmentGateway(getRuntimeConfig().baseUrl ?? '', attachmentRequestHeaders)), [attachmentRequestHeaders]);

  // Initialize chat on mount
  useEffect(() => {
    initializeChat().catch((err) => {
      setError('Failed to initialize chat. Please refresh the page.');
      debugError('Initialization failed', err);
    });
  }, [initializeChat]);

  useEffect(() => {
    const update = () => setBackgrounded(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', update); update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const handleSetupComplete = async (roomId: string, secret: string, controlCapability: string) => {
    try {
      setError('');
      await joinChannel(roomId, secret, controlCapability);
      updateUrlInvite(roomId, secret, controlCapability);
      setShowSetup(false);
    } catch (err) {
      setError('Could not open this conversation. Check the invitation and connection, then retry.');
      debugError('Setup failed', err);
    }
  };

  return (
    <div className={`app-shell ${privacyPreferences.blurSensitiveContent && backgrounded ? 'app-shell--privacy-blur' : ''}`}>
      <Sidebar
        isWelcomeActive={showSetup}
        activeSection={activeSection}
        onNavigate={(section) => { setActiveSection(section); setShowSetup(false); }}
        onNewConversation={() => { setActiveSection('chats'); setShowSetup(true); }}
        onOpenConversation={(roomId) => {
          setActiveSection('chats');
          setShowSetup(false);
          if (roomId) openConversation(roomId).catch(() => setError('Could not open this saved conversation. Your stored data was not changed.'));
        }}
        onOpenSettings={() => setShowSettings(true)}
        settingsOpen={showSettings}
      />
      <section className="conversation-workspace" aria-label="Conversation workspace">
        <SetupOverlay onSetupComplete={handleSetupComplete} onModernSetupComplete={() => {
          // Invitation fragments contain bearer authorization material. Once
          // setup or restore succeeds, keep them out of the active app URL.
          window.history.replaceState(null, '', window.location.pathname);
          setShowSetup(false);
        }} isHidden={!showSetup} />
        {activeSection === 'chats' ? <MediaProvider workflow={mediaWorkflow}><FileProvider>
          <ChatContainer isHidden={showSetup} onNewConversation={() => { setActiveSection('chats'); setShowSetup(true); }} />
        </FileProvider></MediaProvider> : !showSetup && <WorkspaceSection section={activeSection} onNewConversation={() => { setActiveSection('chats'); setShowSetup(true); }} onOpenConversation={(roomId) => {
          setActiveSection('chats');
          openConversation(roomId).catch(() => setError('Could not open this saved conversation. Your stored data was not changed.'));
        }} />}
      </section>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <CallOverlay />
      {error && (
        <div className="app-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default AppContent;
