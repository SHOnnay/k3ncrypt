export const generateUUID = () => {
    if (!globalThis.crypto?.randomUUID) {
        throw new Error('A platform CSPRNG with crypto.randomUUID() is required.');
    }
    return globalThis.crypto.randomUUID();
}
