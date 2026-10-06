import type { FileProgress } from '../../../service/src/files/state';

export interface FileTransferCopy {
  label: string;
  progress?: number;
  active: boolean;
}

const safeFailureCopy = (failure: string): string => {
  const reason = failure.toLocaleLowerCase();
  if (/8 mib|file size/.test(reason)) return 'Files must be 8 MiB or smaller.';
  if (/expired/.test(reason)) return 'This file has expired. Ask your contact to send it again.';
  if (/verification|identity|contact/.test(reason)) return 'Verify this contact again before sending files.';
  if (/quota|storage|full/.test(reason)) return 'There is not enough storage. Free some space, then try again.';
  if (/cache|restart|process/.test(reason)) return 'This transfer was interrupted when the app closed. Select the original file to start again.';
  if (/network|unavailable|timeout|connect|request-failed/.test(reason)) return 'Could not connect. Check your connection and retry in this session.';
  return 'The transfer could not finish. Retry in this session or select the file again.';
};

export const fileTransferCopy = (transfer: FileProgress): FileTransferCopy => {
  const percent = transfer.total > 0 ? Math.min(100, Math.max(0, Math.round((transfer.bytes / transfer.total) * 100))) : undefined;
  const progress = ['Uploading', 'Downloading', 'Verifying'].includes(transfer.phase) ? percent : undefined;
  const name = transfer.filename ? `${transfer.filename} · ` : '';
  switch (transfer.phase) {
    case 'Preparing': return { label: `${name}Preparing…`, active: true };
    case 'Encrypting': return { label: `${name}Protecting file…`, active: true };
    case 'Uploading': return { label: `${name}Sending…${progress === undefined ? '' : ` ${progress}%`}`, progress, active: true };
    case 'WaitingForRecipient': return { label: `${name}Sent securely · waiting for your contact`, active: false };
    case 'Downloading': return { label: `${name}Downloading…${progress === undefined ? '' : ` ${progress}%`}`, progress, active: true };
    case 'Verifying': return { label: `${name}Checking received file…${progress === undefined ? '' : ` ${progress}%`}`, progress, active: true };
    case 'Complete': return { label: `${name}Ready to save`, active: false };
    case 'Canceled': return { label: `${name}Transfer canceled`, active: false };
    case 'Expired': return { label: safeFailureCopy('expired'), active: false };
    case 'RestartRequired': return { label: safeFailureCopy('restart'), active: false };
    case 'Failed': return { label: safeFailureCopy(transfer.failure ?? ''), active: false };
  }
};
