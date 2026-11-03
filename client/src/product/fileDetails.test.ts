import { readFileDetails, rememberFileDetails } from './fileDetails';
import { fileTypeLabel } from './fileTransferCopy';
import { BrowserSecureStorage } from '../../../service/src/storage/secureVault';
import { MemoryVaultPersistence } from '../../../service/src/storage/persistence';

// UX A9: file cards show a type badge (presentation) and the file name once known (remembered locally, encrypted).
it.each([
  ['report.pdf', undefined, 'PDF'], ['photo.JPEG', 'image/jpeg', 'JPEG'], ['archive.tar.gz', undefined, 'GZ'],
  ['notes', 'text/plain', 'TXT'], ['noext', undefined, 'FILE'], ['weird.<script>', undefined, 'FILE'], ['long.verylongext', undefined, 'FILE'],
])('labels %s as %s', (name, mime, label) => { expect(fileTypeLabel(name, mime)).toBe(label); });

it('remembers file details per chat in encrypted storage and caps them', async () => {
  const vault = new BrowserSecureStorage(new MemoryVaultPersistence()); await vault.initializeWithPassphrase('correct horse battery staple');
  await rememberFileDetails(vault, { roomId: 'room-1', transferId: 'transfer-a', details: { name: 'report.pdf', mimeType: 'application/pdf' } });
  await rememberFileDetails(vault, { roomId: 'room-1', transferId: 'transfer-b', details: { name: 'x'.repeat(500), mimeType: 'text/plain' } });
  const details = await readFileDetails(vault, 'room-1');
  expect(details['transfer-a']).toEqual({ name: 'report.pdf', mimeType: 'application/pdf' });
  expect(details['transfer-b'].name.length).toBeLessThanOrEqual(120);
  expect(await readFileDetails(vault, 'room-2')).toEqual({});
  for (let i = 0; i < 520; i++) await rememberFileDetails(vault, { roomId: 'room-3', transferId: `t${i}`, details: { name: `f${i}.bin` } });
  const capped = await readFileDetails(vault, 'room-3');
  expect(Object.keys(capped)).toHaveLength(500); expect(capped.t519).toBeDefined(); expect(capped.t0).toBeUndefined();
});
