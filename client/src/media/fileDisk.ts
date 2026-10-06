import type { FileOutput, SealedFileCache, WireObject } from '@chat-e2ee/service';
export interface SavedFile { file: File; filename: string; dispose: () => Promise<void>; }
const directory = async (): Promise<FileSystemDirectoryHandle> => {
    if (!navigator.storage?.getDirectory) throw new Error('Secure file storage unavailable.');
    const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('k3ncrypt-files-v2', { create: true });
};
export const clearFileDisk = async (): Promise<void> => { const root = await navigator.storage.getDirectory(); await root.removeEntry('k3ncrypt-files-v2', { recursive: true }).catch(() => undefined); };
const space = async (required: number): Promise<void> => { const estimate = await navigator.storage.estimate(); if (estimate.quota === undefined || estimate.usage === undefined) throw new Error('Secure file storage unavailable.'); if (estimate.quota - estimate.usage < required + 1024 * 1024) throw new Error('Not enough local storage space.'); };
export const createSealedCache = async (): Promise<SealedFileCache> => {
    await space(12 * 1024 * 1024); const root = await directory(); const id = crypto.randomUUID(); const dir = await root.getDirectoryHandle(id, { create: true });
    return {
        async get(index) { try { const f = await (await dir.getFileHandle(`sealed-${index}`)).getFile(); if (f.size > 360000) throw new Error('File cache invalid.'); return JSON.parse(await f.text()) as WireObject; } catch (e) { if (e instanceof DOMException && e.name === 'NotFoundError') return undefined; throw e; } },
        async put(index, value) { const handle = await dir.getFileHandle(`sealed-${index}`, { create: true }); if (typeof handle.createWritable !== 'function') throw new Error('Secure file storage unavailable.'); const stream = await handle.createWritable(); try { await stream.write(JSON.stringify(value)); await stream.close(); } catch (e) { await stream.abort(); throw e; } },
        clear: () => root.removeEntry(id, { recursive: true }).catch(() => undefined),
    };
};
export const createFileOutput = async (size: number): Promise<FileOutput<SavedFile>> => {
    await space(size); const root = await directory(); const id = crypto.randomUUID(); const dir = await root.getDirectoryHandle(id, { create: true }); const handle = await dir.getFileHandle('incomplete-output', { create: true }); if (typeof handle.createWritable !== 'function') throw new Error('Secure file storage unavailable.'); const stream = await handle.createWritable(); let closed = false; let written = 0;
    const discard = async (): Promise<void> => { if (!closed) { closed = true; await stream.abort().catch(() => undefined); } await root.removeEntry(id, { recursive: true }).catch(() => undefined); };
    return {
        async write(bytes) { if (closed || written + bytes.length > size) throw new Error('File output invalid.'); await stream.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); written += bytes.length; },
        async finish(manifest) { if (written !== size) throw new Error('File incomplete.'); await stream.close(); closed = true; return { file: await handle.getFile(), filename: manifest.filename, dispose: discard }; },
        discard,
    };
};
