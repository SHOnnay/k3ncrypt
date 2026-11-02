import { connectionCopy } from '../content/checkCopy';

export type ConnectionStatus = 'connected' | 'connecting' | 'offline';

/** One status for the chat header. Says nothing about whether the contact is online. */
export const connectionStatus = (browserOnline: boolean, relayConnected: boolean): ConnectionStatus =>
  !browserOnline ? 'offline' : relayConnected ? 'connected' : 'connecting';

export const connectionStatusCopy = (status: ConnectionStatus): { label: string; help?: string } =>
  status === 'connected' ? { label: connectionCopy.connected }
    : status === 'offline' ? { label: connectionCopy.offline, help: connectionCopy.offlineHelp }
      : { label: connectionCopy.connecting, help: connectionCopy.connectingHelp };
