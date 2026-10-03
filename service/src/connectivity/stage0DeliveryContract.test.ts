import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Stage 0 cross-platform evidence contract (fixtures, not live interoperability)', () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/stage0/current-delivery.json'), 'utf8'));
    it.each(['Web->Web', 'Web->Android', 'Android->Web', 'Android->Android'])('%s never promotes relay evidence to authenticated peer persistence', (pair) => {
        expect(fixture.pairings).toContain(pair);
        expect(fixture.authenticatedPeerPersistedImplemented).toBe(false);
        for (const observation of fixture.observations) {
            expect(observation.peerPersistence).toBe(false);
            expect(observation.authenticatedPeerEvidence).toBe(false);
        }
        expect(fixture.completion[pair.split('->')[0]]).toBe(pair.startsWith('Web') ? 'relay-delivered-event' : 'relay-submission-response');
    });
    it('keeps mailbox storage, local acceptance and relay delivery distinct', () => {
        const records = Object.fromEntries(fixture.observations.map((item: { event: string }) => [item.event, item]));
        expect(records['chat-message-mailbox-ack'].wire).toEqual({ id: 'synthetic-relay-id', timestamp: 1, stored: true });
        expect(records['chat-message-live-ack'].wire).toEqual({ id: 'synthetic-relay-id', timestamp: 1 });
        expect(records['receiver-local-callback'].state).toBe('PEER_ACCEPTED');
        expect(records.delivered.state).toBe('RELAY_DELIVERED');
    });
});
