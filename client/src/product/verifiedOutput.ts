import type { SavedFile } from '../media/fileDisk';

export interface DetachedOutput { blob: Blob; filename: string; mimeType?: string }

const PREVIEWABLE_IMAGE = /^image\/(png|jpeg|webp|gif)$/;
export const previewableImageType = (mimeType: string | undefined): string | undefined =>
  mimeType && PREVIEWABLE_IMAGE.test(mimeType) ? mimeType : undefined;

/**
 * Moves a verified, fully integrity-checked download off the single-slot secure disk workspace into
 * page memory and releases the slot. The file is already plaintext once verified; holding it in the
 * open page (as the object URL always did) is no weaker, and it stops one finished download from
 * blocking every other attachment until the user manually discards it. The disk copy is released
 * even if reading fails, so a failure cannot wedge the workspace.
 */
export const detachVerifiedOutput = async (saved: Pick<SavedFile, 'file' | 'filename' | 'mimeType' | 'dispose'>): Promise<DetachedOutput> => {
  try {
    const bytes = await saved.file.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) { new Uint8Array(bytes).fill(0); throw new Error('File exceeds preview limit.'); }
    const type = previewableImageType(saved.mimeType) ?? 'application/octet-stream';
    try { return { blob: new Blob([bytes], { type }), filename: saved.filename, mimeType: saved.mimeType }; }
    finally { new Uint8Array(bytes).fill(0); }
  } finally {
    await saved.dispose().catch(() => undefined);
  }
};
