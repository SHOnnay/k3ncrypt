/** A machine address is separate from human verification text. Existing public fingerprints are not rewritten. */
export const canonicalIdentityRecordId = async (reference: string): Promise<string> => {
    if (!reference || reference.length > 256 || reference.normalize('NFC') !== reference || /[\u0000-\u001f\u007f]/u.test(reference)) throw new Error('Invalid identity reference.');
    if (/^[A-Za-z0-9._:-]{1,128}$/.test(reference)) return reference;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`k3ncrypt:identity-record:v1\0${reference}`));
    return `identity-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};
