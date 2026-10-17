import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileTransferWorkflow, sameBinding, type FileProgress } from '@chat-e2ee/service';
import { classifySafeDiagnostic, logSafeFailure } from '../product/safeDiagnostics';
import { PreviewResources, FileOperationGate, FileOperationBusyError } from '../product/previewResources';
import { useChat } from './ChatContext';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { HttpFileGateway } from '../media/HttpFileGateway';
import { clearFileDisk, createFileOutput, createSealedCache, type SavedFile } from '../media/fileDisk';
interface FileContextValue { previews: PreviewResources; transfer: FileProgress; download?: { reference: string; transfer: FileProgress }; sendFile(file: File): Promise<void>; retry(): Promise<void>; cancel(): void; receive(text: string): Promise<SavedFile | undefined>; }
const Context = createContext<FileContextValue | undefined>(undefined);
export const FileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { fileTransferBindingForRoom, attachmentRequestHeadersForRoom, sendMessageForRoom, channelHash, plaintextSession } = useChat();
    const [diskReady, setDiskReady] = useState(false);
    const saved = useRef<SavedFile>();
    const operation = useRef(new FileOperationGate());
    const previews = useMemo(() => new PreviewResources(), [channelHash, plaintextSession]);
    const live = useRef<{ room: string; scope?: object; mounted: boolean }>({ room: channelHash, scope: plaintextSession, mounted: true });
    live.current.room = channelHash; live.current.scope = plaintextSession;
    const current = () => live.current.mounted && plaintextSession?.isCurrent() === true && live.current.scope === plaintextSession && live.current.room === channelHash;
    const currentRoom = useRef(channelHash);
    currentRoom.current = channelHash;
    const [transfer, changed] = useState<FileProgress>({ phase: 'Idle', bytes: 0, total: 0 });
    const activeDownload = useRef<string>();
    const [download, setDownload] = useState<FileContextValue['download']>();
    const workflow = useMemo(() => new FileTransferWorkflow(
        new HttpFileGateway(getRuntimeConfig().baseUrl ?? '', operation => {
            if (!current() || !channelHash) throw new Error('Protected file transfer requires an open room.');
            return attachmentRequestHeadersForRoom(channelHash, operation);
        }),
        verified => {
            if (!current() || !channelHash) throw new Error('Protected file transfer requires an open room.');
            return fileTransferBindingForRoom(channelHash, verified);
        },
        createSealedCache,
        async (reference, binding) => {
            if (!current() || !channelHash || !sameBinding(await fileTransferBindingForRoom(channelHash, true), binding)) throw new Error('File contact identity changed.');
            await sendMessageForRoom(channelHash, reference);
        },
        progress => { if (!current() || currentRoom.current !== channelHash) return; if (progress.phase === 'Failed') logSafeFailure(activeDownload.current ? 'file_download_failed' : 'file_send_failed', classifySafeDiagnostic('file-send', { safeDiagnosticCode: progress.diagnosticCode })); if (activeDownload.current) setDownload({ reference: activeDownload.current, transfer: progress }); else changed(progress); },
    ), [attachmentRequestHeadersForRoom, channelHash, plaintextSession, fileTransferBindingForRoom, sendMessageForRoom]);
    useEffect(() => {
        activeDownload.current = undefined;
        changed({ phase: 'Idle', bytes: 0, total: 0 });
        setDownload(undefined);
    }, [channelHash]);
    useEffect(() => {
        const abort = new AbortController(); let release: (() => void) | undefined; let disposed = false;
        if (navigator.locks) void navigator.locks.request('k3ncrypt-file-workspace-v2', { signal: abort.signal }, async lock => {
            if (!lock || disposed) return;
            await clearFileDisk(); if (disposed) return;
            setDiskReady(true); await new Promise<void>(resolve => { release = resolve; });
        }).catch(() => { if (!disposed) setDiskReady(false); });
        return () => { disposed = true; setDiskReady(false); abort.abort(); release?.(); };
    }, []);
    useLayoutEffect(() => {
        live.current.mounted = true;
        return () => { live.current.mounted = false; workflow.dispose(); previews.clear(); void saved.current?.dispose(); };
    }, [workflow, previews]);
    const runExclusive = async (run: () => Promise<void>) => {
        if (!current()) throw new Error('Unlock and open the intended conversation.');
        const ticket = operation.current.acquire();
        if (!ticket) throw new FileOperationBusyError('Another file operation is still active.');
        try { await run(); } finally { operation.current.release(ticket); }
    };
    return <Context.Provider value={{ previews, transfer, download,
        sendFile: file => runExclusive(async () => {
            if (!diskReady) throw new Error('Secure disk workspace unavailable or in use by another tab.');
            await workflow.send({ size: file.size, name: file.name, type: file.type, read: async (at, count) => new Uint8Array(await file.slice(at, at + count).arrayBuffer()) });
        }), retry: () => runExclusive(() => workflow.retry()), cancel: () => workflow.cancel(), receive: async text => {
        if (!current() || !diskReady) throw new Error('Secure file workspace unavailable.');
        const ticket = operation.current.acquire();
        if (!ticket) throw new FileOperationBusyError('Another file operation is still active.');
        activeDownload.current = text;
        setDownload(undefined);
        let result: SavedFile | undefined;
        try {
            result = await workflow.receive(text, createFileOutput);
            if (!result || !current()) { await result?.dispose(); return undefined; }
            const original = result.dispose;
            let disposal: Promise<void> | undefined;
            const tracked = { ...result, dispose: () => disposal ??= (async () => {
                try { await original(); } finally {
                    if (saved.current === tracked) saved.current = undefined;
                    operation.current.release(ticket);
                }
            })() };
            saved.current = tracked;
            return tracked;
        } finally {
            if (activeDownload.current === text) activeDownload.current = undefined;
            if (!result || !current()) operation.current.release(ticket);
        }
    } }}>{children}</Context.Provider>;
};
export const useFiles = (): FileContextValue => { const value = useContext(Context); if (!value) throw new Error('FileProvider missing.'); return value; };
