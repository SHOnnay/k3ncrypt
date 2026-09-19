/**
 * Application entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatProvider } from './context/ChatContext';
import { ThemeProvider } from './theme/ThemeContext';
import App from './App';
import { loadVodozemacBindings } from './crypto/vodozemacModule';
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
