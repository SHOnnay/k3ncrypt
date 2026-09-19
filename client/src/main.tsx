/**
 * Application entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatProvider } from './context/ChatContext';
import { ThemeProvider } from './theme/ThemeContext';
import App from './App';

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
