// UI-only deterministic harness. Transport mocks are installed by the Playwright test;
// this fixture is never imported by the application and does not assert E2EE success.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatFooter } from '../../client/src/components/ChatContainer/ChatFooter';
import { MessagesArea } from '../../client/src/components/ChatContainer/MessagesArea';
import { SettingsPanel } from '../../client/src/components/Settings/SettingsPanel';
import { ThemeProvider } from '../../client/src/theme/ThemeContext';
import '../../client/src/theme/tokens.css';

function Fixture() {
  const [, refresh] = useState(0);
  useEffect(() => (window as any).__ui.subscribe(() => refresh(value => value + 1)), []);
  const [settings, setSettings] = useState(false);
  return <ThemeProvider><output id="room-marker">{(window as any).__ui.snapshot().channelHash}</output><button id="settings-opener" onClick={() => setSettings(true)}>Settings</button>
    <div style={{height:450,display:'flex',flexDirection:'column'}}><MessagesArea /><ChatFooter onVerifyContact={() => undefined} /></div>
    <SettingsPanel isOpen={settings} onClose={() => setSettings(false)} /></ThemeProvider>;
}
createRoot(document.getElementById('app')!).render(<Fixture />);
