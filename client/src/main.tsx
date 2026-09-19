/**
 * Application entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatProvider } from './context/ChatContext';
import { ThemeProvider } from './theme/ThemeContext';
import App from './App';
import { VODOZEMAC_WASM_URL } from './crypto/vodozemacArtifact';

// Keep the audited local crypto artifact in the production asset graph without
// initializing or selecting the modern protocol for existing conversations.
void VODOZEMAC_WASM_URL;

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
