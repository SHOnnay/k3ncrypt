/**
 * Application entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatProvider } from './context/ChatContext';
import { ThemeProvider } from './theme/ThemeContext';
import App from './App';
import { loadVodozemacBindings } from './crypto/vodozemacModule';

// Remove the isolated resume database used by an earlier local testing build.
// It never contains production vault records and is no longer read by the app.
if (globalThis.indexedDB) {
  const removal = indexedDB.deleteDatabase('k3ncrypt-dev-vault-resume');
  removal.onerror = () => undefined;
  removal.onblocked = () => undefined;
}

// Initialize the local generated module at application startup. The modern
// protocol remains opt-in; no identity or session is created by this probe.
void loadVodozemacBindings().catch(() => undefined);

const root = ReactDOM.createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <ChatProvider>
        <App />
      </ChatProvider>
    </ThemeProvider>
  </React.StrictMode>
);
