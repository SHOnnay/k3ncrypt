/**
 * Main App component
 */

import React, { useEffect, useState } from 'react';
import { useChat } from './context/ChatContext';
import { SetupOverlay } from './components/SetupOverlay/SetupOverlay';
import { ChatContainer } from './components/ChatContainer/ChatContainer';
import { updateUrlInvite } from './utils/urlHash';
import { Sidebar } from './components/AppShell/Sidebar';
import { PrivacyPanel } from './components/AppShell/PrivacyPanel';
import './styles/global.css';
import { debugError } from './utils/debug';

const AppContent: React.FC = () => {
  const { initializeChat, joinChannel } = useChat();
  const [showSetup, setShowSetup] = useState(true);
  const [error, setError] = useState<string>('');
  const [showPrivacy, setShowPrivacy] = useState(false);

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
    <div className={`app-shell ${showPrivacy ? 'privacy-open' : ''}`}>
      <Sidebar
        isWelcomeActive={showSetup}
        onNewConversation={() => setShowSetup(true)}
        onOpenConversation={() => setShowSetup(false)}
        onOpenPrivacy={() => setShowPrivacy((current) => !current)}
      />
      <section className="conversation-workspace" aria-label="Conversation workspace">
        <SetupOverlay onSetupComplete={handleSetupComplete} isHidden={!showSetup} />
        <ChatContainer isHidden={showSetup} />
      </section>
      <PrivacyPanel isOpen={showPrivacy} onClose={() => setShowPrivacy(false)} />
      {error && (
        <div className="app-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default AppContent;
