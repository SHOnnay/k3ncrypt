import { createEncryptedVoiceMessage } from './voiceMessage';
import { decryptAttachment } from '../attachments';

it('builds an encrypted voice message through the attachment subsystem', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const { message, key } = await createEncryptedVoiceMessage(audio, 1250);
    expect(message.durationMs).toBe(1250);
    expect(message.mimeType).toBe('audio/webm;codecs=opus');
    expect(await decryptAttachment(message.attachment, message.chunks, key)).toEqual(audio);
});

it('rejects empty audio and invalid durations', async () => {
    await expect(createEncryptedVoiceMessage(new Uint8Array(), 1)).rejects.toThrow('empty');
    await expect(createEncryptedVoiceMessage(new Uint8Array([1]), -1)).rejects.toThrow('duration');
});
