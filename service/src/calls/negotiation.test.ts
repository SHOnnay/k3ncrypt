import { ProductionCallNegotiator } from './negotiation';
import { CallMediaController } from './media';
import type { CallSession, CallSignal } from './contracts';
import type { CallMediaConnection } from './webrtc';

const session = (): CallSession => ({ callId: 'call-1', conversationId: 'room', participants: [{ participantId: 'alice', identityId: 'alice-id', verification: 'verified' }, { participantId: 'bob', identityId: 'bob-id', verification: 'verified' }], mediaMode: 'audio', identityBinding: 'bound', state: 'accepted', createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 60_000 });
const signal = (kind: CallSignal['kind'], payload: unknown): CallSignal => ({ callId: 'call-1', conversationId: 'room', sender: { participantId: 'bob', identityId: 'bob-id', verification: 'verified' }, receiverIdentityId: 'alice-id', mediaMode: 'audio', nonce: '11111111-1111-4111-8111-111111111111', event: kind === 'offer' ? 'connect' : 'connected', kind, payload, sequence: 2, timestamp: Date.now(), expiresAt: Date.now() + 60_000, identityBinding: 'bound', payloadDigest: 'digest' });
const track = { stop: jest.fn() } as unknown as MediaStreamTrack;
const stream = { getTracks: () => [track] } as unknown as MediaStream;

describe('production WebRTC negotiation boundary', () => {
  const setup = () => {
    let current = session(); let receiver: ((value: CallSession, value2: CallSignal) => Promise<void>) | undefined;
    const service = { get: jest.fn(async () => current), event: jest.fn(async (_id: string, event: string) => { current = { ...current, state: event === 'connect' ? 'connecting' : event === 'connected' ? 'connected' : event === 'reconnect' ? 'reconnecting' : event === 'fail' ? 'failed' : event === 'end' ? 'ended' : current.state, updatedAt: Date.now() }; return current; }) };
    const calls: any = { service, onMediaSignal: jest.fn((listener) => { receiver = listener; return () => undefined; }), sendMediaSignal: jest.fn(async () => undefined) };
    const connection: CallMediaConnection & { addStream: jest.Mock; state: (value: any) => void } = { createOffer: jest.fn(async () => ({ type: 'offer', sdp: 'v=0' })), acceptOffer: jest.fn(async () => ({ type: 'answer', sdp: 'v=0' })), acceptAnswer: jest.fn(async () => undefined), addIceCandidate: jest.fn(async () => undefined), close: jest.fn(async () => undefined), onIceCandidate: jest.fn(() => () => undefined), onStateChange: jest.fn((listener) => { connection.state = listener; return () => undefined; }), addStream: jest.fn(), state: () => undefined };
    const media = new CallMediaController({ getUserMedia: jest.fn(async () => stream) });
    const negotiator = new ProductionCallNegotiator(calls, { connect: jest.fn(async () => connection) }, async () => ({ iceServers: [], iceTransportPolicy: 'relay' }), media);
    return { current: () => current, receiver: () => receiver!, service, calls, connection, negotiator };
  };

  it('rejects malformed SDP before it reaches the peer connection', async () => {
    const test = setup(); await test.negotiator.acceptIncoming(test.current());
    await expect(test.receiver()(test.current(), signal('offer', { type: 'offer', sdp: '' }))).rejects.toThrow('offer rejected');
    expect(test.connection.acceptOffer).not.toHaveBeenCalled();
  });

  it('offers only after explicit media preparation and sends authenticated SDP', async () => {
    const test = setup(); await test.negotiator.prepareOutgoing(test.current()); await test.negotiator.beginOffer('call-1');
    expect(test.connection.addStream).toHaveBeenCalledWith(stream);
    expect(test.calls.sendMediaSignal).toHaveBeenCalledWith('call-1', 'connect', 'offer', { type: 'offer', sdp: 'v=0' });
  });

  it('fails closed and releases capture on an ICE failure', async () => {
    const test = setup(); await test.negotiator.prepareOutgoing(test.current()); test.connection.state('failed'); await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(test.service.event).toHaveBeenCalledWith('call-1', 'fail');
    expect(track.stop as jest.Mock).toHaveBeenCalled();
  });

  it('does not begin media when permission is denied', async () => {
    const base = setup(); const denied = new ProductionCallNegotiator(base.calls, { connect: jest.fn(async () => base.connection) }, async () => ({ iceServers: [] }), new CallMediaController({ getUserMedia: async () => { throw new Error('denied'); } }));
    await expect(denied.acceptIncoming(base.current())).rejects.toThrow('permission was denied');
    expect(base.connection.close).toHaveBeenCalled();
  });
});
