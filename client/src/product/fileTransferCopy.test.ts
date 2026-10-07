import { fileDownloadForReference, fileTransferCopy } from './fileTransferCopy';

describe('file transfer wording', () => {
  it('translates protocol phases to progress a person can follow', () => {
    expect(fileTransferCopy({ phase: 'Uploading', bytes: 25, total: 100, filename: 'photo.jpg' })).toEqual({ label: 'photo.jpg · Sending… 25%', progress: 25, active: true });
    expect(fileTransferCopy({ phase: 'Verifying', bytes: 100, total: 100 })).toEqual({ label: 'Checking received file… 100%', progress: 100, active: true });
    expect(fileTransferCopy({ phase: 'Complete', bytes: 100, total: 100 }).label).toBe('Ready to save');
  });

  it('uses bounded, actionable failure language without exposing internal errors', () => {
    expect(fileTransferCopy({ phase: 'Failed', bytes: 0, total: 100, failure: 'attachment:create request-failed' }).label).toBe('Could not connect. Check your connection and retry in this session.');
    expect(fileTransferCopy({ phase: 'Failed', bytes: 0, total: 100, failure: 'Sealed file cache was lost.' }).label).toContain('original file');
  });

  it('distinguishes server quota, generic failure, restart and idle', () => {
    expect(fileTransferCopy({ phase: 'Idle', bytes: 0, total: 0 }).label).toBe('');
    expect(fileTransferCopy({ phase: 'Failed', bytes: 0, total: 0, failure: 'File storage quota reached.' }).label).toContain('older files expire');
    expect(fileTransferCopy({ phase: 'Failed', bytes: 0, total: 0, failure: 'File transfer failed. Select the file again to restart.' }).label).toContain('Couldn’t send');
    expect(fileTransferCopy({ phase: 'RestartRequired', bytes: 0, total: 0 }).label).toContain('original file');
  });

  it('does not display bytes, transfer phases, or transfer identifiers', () => {
    const copy = fileTransferCopy({ phase: 'Downloading', bytes: 25, total: 100, filename: 'photo.jpg' });
    expect(copy.label).toBe('photo.jpg · Downloading… 25%');
    expect(copy.label).not.toMatch(/25\/100|k3ncrypt-file|transferid/i);
  });

  it('only projects download progress onto the matching file reference', () => {
    const download = { reference: 'file-reference-a', transfer: { phase: 'Downloading' as const, bytes: 25, total: 100 } };
    expect(fileDownloadForReference(download, 'file-reference-a')).toBe(download.transfer);
    expect(fileDownloadForReference(download, 'file-reference-b')).toBeUndefined();
    expect(fileDownloadForReference(undefined, 'file-reference-a')).toBeUndefined();
  });
});
