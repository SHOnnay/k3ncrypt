export class PreviewCapacityError extends Error {}
export class FileOperationBusyError extends Error {}

/** Transient verified output only. No persistence, and no authorization decisions. */
export class PreviewResources {
  private readonly urls = new Map<string, { url: string; bytes: number }>();
  private bytes = 0;
  constructor(private readonly create = (blob: Blob) => URL.createObjectURL(blob), private readonly revoke = (url: string) => URL.revokeObjectURL(url)) {}
  add(key: string, blob: Blob): string {
    // Retain up to three unsaved files; never silently discard an older Save link.
    if (blob.size > 8 * 1024 * 1024 || (!this.urls.has(key) && this.urls.size >= 3) || this.bytes - (this.urls.get(key)?.bytes ?? 0) + blob.size > 24 * 1024 * 1024)
      throw new PreviewCapacityError('Close an open preview before downloading another file.');
    this.release(key);
    const url = this.create(blob); this.urls.set(key, { url, bytes: blob.size }); this.bytes += blob.size;
    return url;
  }
  release(key: string): void {
    const value = this.urls.get(key); if (!value) return;
    this.urls.delete(key); this.bytes -= value.bytes; this.revoke(value.url);
  }
  clear(): void { for (const key of this.urls.keys()) this.release(key); }
}

/** Serializes acquisition before the workflow's first asynchronous authorization boundary. */
export class FileOperationGate {
  private active?: object;
  acquire(): object | undefined { if (this.active) return undefined; return this.active = {}; }
  release(ticket: object): void { if (this.active === ticket) this.active = undefined; }
}
