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

const AppContent: React.FC = () => {
  const { initializeChat, joinChannel, openConversation, attachmentRequestHeaders } = useChat();
  const [showSetup, setShowSetup] = useState(true);
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const mediaWorkflow = useMemo(() => new MediaMessageWorkflow(new HttpAttachmentGateway(getRuntimeConfig().baseUrl ?? '', attachmentRequestHeaders)), [attachmentRequestHeaders]);

  // Initialize chat on mount
  useEffect(() => {
    initializeChat().catch((err) => {
      setError('Failed to initialize chat. Please refresh the page.');
      debugError('Initialization failed', err);
    });
  }, [initializeChat]);

  const handleSetupComplete = async (roomId: string, secret: string, controlCapability: string) => {
    try {
      setError('');
      await joinChannel(roomId, secret, controlCapability);
      updateUrlInvite(roomId, secret, controlCapability);
      setShowSetup(false);
    } catch (err) {
      setError((err as any).message || 'Failed to connect. Please try again.');
      debugError('Setup failed', err);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        isWelcomeActive={showSetup}
        onNewConversation={() => setShowSetup(true)}
        onOpenConversation={(roomId) => {
          setShowSetup(false);
          if (roomId) openConversation(roomId).catch((err) => setError((err as Error).message));
        }}
        onOpenSettings={() => setShowSettings(true)}
      />
      <section className="conversation-workspace" aria-label="Conversation workspace">
        <SetupOverlay onSetupComplete={handleSetupComplete} onModernSetupComplete={(inviteLink) => {
          window.history.replaceState(null, '', inviteLink);
          setShowSetup(false);
        }} isHidden={!showSetup} />
        <MediaProvider workflow={mediaWorkflow}>
          <ChatContainer isHidden={showSetup} />
        </MediaProvider>
      </section>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      {error && (
        <div className="app-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default AppContent;
