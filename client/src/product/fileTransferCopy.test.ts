import { fileTransferCopy } from './fileTransferCopy';

describe('file transfer wording', () => {
  it('translates protocol phases to progress a person can follow', () => {
    expect(fileTransferCopy({ phase: 'Uploading', bytes: 25, total: 100, filename: 'photo.jpg' })).toEqual({ label: 'photo.jpg · Sending… 25%', progress: 25, active: true });
    expect(fileTransferCopy({ phase: 'Verifying', bytes: 100, total: 100 })).toEqual({ label: 'Checking received file… 100%', progress: 100, active: true });
    expect(fileTransferCopy({ phase: 'Complete', bytes: 100, total: 100 }).label).toBe('Ready to save');
  });

  it('uses bounded, actionable failure language without exposing internal errors', () => {
    expect(fileTransferCopy({ phase: 'Failed', bytes: 0, total: 100, failure: 'attachment:create request-failed' }).label).toBe('Could not connect. Check your connection and retry in this session.');
    expect(fileTransferCopy({ phase: 'Failed', bytes: 0, total: 100, failure: 'Sealed file cache was lost.' }).label).toContain('app closed');
  });

  it('does not display bytes, transfer phases, or transfer identifiers', () => {
    const copy = fileTransferCopy({ phase: 'Downloading', bytes: 25, total: 100, filename: 'photo.jpg' });
    expect(copy.label).toBe('photo.jpg · Downloading… 25%');
    expect(copy.label).not.toMatch(/25\/100|k3ncrypt-file|transferid/i);
  });
});
