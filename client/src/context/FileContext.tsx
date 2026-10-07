import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileTransferWorkflow, sameBinding, type FileProgress } from '@chat-e2ee/service';
import { classifySafeDiagnostic, logSafeFailure } from '../product/safeDiagnostics';
import { useChat } from './ChatContext';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { HttpFileGateway } from '../media/HttpFileGateway';
import { clearFileDisk, createFileOutput, createSealedCache, type SavedFile } from '../media/fileDisk';
interface FileContextValue { transfer: FileProgress; download?: { reference: string; transfer: FileProgress }; sendFile(file: File): Promise<void>; retry(): Promise<void>; cancel(): void; receive(text: string): Promise<SavedFile | undefined>; }
const Context = createContext<FileContextValue | undefined>(undefined);
export const FileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { fileTransferBindingForRoom, attachmentRequestHeadersForRoom, sendMessageForRoom, channelHash } = useChat();
    const [diskReady, setDiskReady] = useState(false);
    const saved = useRef<SavedFile>();
    const [transfer, changed] = useState<FileProgress>({ phase: 'Idle', bytes: 0, total: 0 });
    const activeDownload = useRef<string>();
    const [download, setDownload] = useState<FileContextValue['download']>();
    const workflow = useMemo(() => new FileTransferWorkflow(
        new HttpFileGateway(getRuntimeConfig().baseUrl ?? '', operation => {
            if (!channelHash) throw new Error('Protected file transfer requires an open room.');
            return attachmentRequestHeadersForRoom(channelHash, operation);
        }),
        verified => {
            if (!channelHash) throw new Error('Protected file transfer requires an open room.');
            return fileTransferBindingForRoom(channelHash, verified);
        },
        createSealedCache,
        async (reference, binding) => {
            if (!channelHash || !sameBinding(await fileTransferBindingForRoom(channelHash, true), binding)) throw new Error('File contact identity changed.');
            await sendMessageForRoom(channelHash, reference);
        },
        progress => { if (progress.phase === 'Failed') logSafeFailure(activeDownload.current ? 'file_download_failed' : 'file_send_failed', classifySafeDiagnostic('file-send', { safeDiagnosticCode: progress.diagnosticCode })); if (activeDownload.current) setDownload({ reference: activeDownload.current, transfer: progress }); else changed(progress); },
    ), [attachmentRequestHeadersForRoom, channelHash, fileTransferBindingForRoom, sendMessageForRoom]);
    useEffect(() => {
        const abort = new AbortController(); let release: (() => void) | undefined; let disposed = false;
        if (navigator.locks) void navigator.locks.request('k3ncrypt-file-workspace-v2', { signal: abort.signal }, async lock => {
            if (!lock || disposed) return;
            await clearFileDisk(); if (disposed) return;
            setDiskReady(true); await new Promise<void>(resolve => { release = resolve; });
        }).catch(() => { if (!disposed) setDiskReady(false); });
        return () => { disposed = true; setDiskReady(false); abort.abort(); release?.(); };
    }, []);
    useEffect(() => () => workflow.dispose(), [workflow]);
    return <Context.Provider value={{ transfer, download, sendFile: file => { if (!diskReady) { changed({ phase: 'Failed', bytes: 0, total: 0, failure: 'Secure disk workspace unavailable or in use by another tab.', diagnosticCode: 'FILE_PREFLIGHT_FAILED' }); return Promise.resolve(); } return workflow.send({ size: file.size, name: file.name, type: file.type, read: async (at, count) => new Uint8Array(await file.slice(at, at + count).arrayBuffer()) }); }, retry: () => workflow.retry(), cancel: () => workflow.cancel(), receive: async text => {
        if (!diskReady || saved.current) { setDownload({ reference: text, transfer: { phase: 'Failed', bytes: 0, total: 0, failure: 'Save or discard the previous verified output before another download.', diagnosticCode: 'FILE_PREFLIGHT_FAILED' } }); return undefined; }
        activeDownload.current = text;
        setDownload(undefined);
        let result: SavedFile | undefined;
        try { result = await workflow.receive(text, createFileOutput); }
        finally { activeDownload.current = undefined; }
        if (!result) return undefined;
        const original = result.dispose;
        const tracked = { ...result, dispose: async () => { await original(); if (saved.current === tracked) saved.current = undefined; } };
        saved.current = tracked; return tracked;
    } }}>{children}</Context.Provider>;
};
export const useFiles = (): FileContextValue => { const value = useContext(Context); if (!value) throw new Error('FileProvider missing.'); return value; };
