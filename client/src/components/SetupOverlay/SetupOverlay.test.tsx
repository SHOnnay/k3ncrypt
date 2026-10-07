import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupOverlay } from './SetupOverlay';

const mockUseChat = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./SetupOverlay.css', () => ({}));
jest.mock('./CreateHashView.css', () => ({}));
jest.mock('./JoinHashView.css', () => ({}));
jest.mock('./InitialActions.css', () => ({}));
jest.mock('../common/Button.css', () => ({}));
jest.mock('../common/Input.css', () => ({}));

const renderSetup = (accountState: 'checking' | 'new' | 'locked' | 'ready'): string => {
  mockUseChat.mockReturnValue({
    createNewChannel: jest.fn(), createModernChannel: jest.fn(), joinModernChannel: jest.fn(),
    restoreSession: jest.fn(), accountState,
  });
  return renderToStaticMarkup(createElement(SetupOverlay, { isHidden: false, onSetupComplete: async () => undefined, onModernSetupComplete: () => undefined }));
};

describe('first-run and returning-account setup', () => {
  it('shows connection progress instead of actions while startup is unresolved', () => {
    const markup = renderSetup('checking');
    expect(markup).toContain('Connecting to K3NCRYPT');
    expect(markup).toContain('three-node-wait');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('Create your private account');
  });

  it('offers unlock for a saved locked account without presenting account creation', () => {
    const markup = renderSetup('locked');
    expect(markup).toContain('Unlock this device');
    expect(markup).not.toContain('Create your private account');
  });

  it('labels first-use account creation distinctly from adding a contact', () => {
    expect(renderSetup('new')).toContain('Create your private account');
    const returning = renderSetup('ready');
    expect(returning).toContain('Invite someone');
    expect(returning).not.toContain('Create your private account');
  });
});
