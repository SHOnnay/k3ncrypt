export type FilePhase = 'Idle' | 'Preparing' | 'Encrypting' | 'Uploading' | 'WaitingForRecipient' | 'Downloading' | 'Verifying' | 'Complete' | 'Canceled' | 'Failed' | 'Expired' | 'RestartRequired';
export interface FileProgress { phase: FilePhase; bytes: number; total: number; filename?: string; failure?: string; retryable?: boolean; diagnosticCode?: string; }
const transitions: Record<FilePhase, readonly FilePhase[]> = {
    Idle: [], Preparing: ['Encrypting', 'Downloading', 'Canceled', 'Failed', 'Expired', 'RestartRequired'],
    Encrypting: ['Uploading', 'Canceled', 'Failed', 'Expired', 'RestartRequired'],
    Uploading: ['Encrypting', 'WaitingForRecipient', 'Canceled', 'Failed', 'Expired', 'RestartRequired'],
    WaitingForRecipient: [], Downloading: ['Verifying', 'Canceled', 'Failed', 'Expired', 'RestartRequired'],
    Verifying: ['Downloading', 'Complete', 'Canceled', 'Failed', 'Expired', 'RestartRequired'],
    Complete: [], Canceled: [], Failed: [], Expired: [], RestartRequired: [],
};
/** A retry gets a new generation. Terminal generations never accept delayed callbacks. */
export class FileTransferState {
    private generation = 0;
    private current: FileProgress = { phase: 'Idle', bytes: 0, total: 0 };
    constructor(private readonly changed: (value: FileProgress) => void = () => {}) {}
    begin(total: number, filename?: string): number { this.generation++; this.current = { phase: 'Preparing', bytes: 0, total, filename }; this.changed(this.current); return this.generation; }
    live(generation: number): boolean { return generation === this.generation && transitions[this.current.phase].length > 0; }
    move(generation: number, phase: FilePhase, bytes = this.current.bytes, failure?: string, retryable = false, diagnosticCode?: string): boolean {
        if (generation !== this.generation || (phase !== this.current.phase && !transitions[this.current.phase].includes(phase)) || transitions[this.current.phase].length === 0) return false;
        this.current = { ...this.current, phase, bytes, failure, retryable, diagnosticCode }; this.changed(this.current); return true;
    }
    details(generation: number, total: number, filename?: string): void { if (!this.live(generation)) return; this.current = { ...this.current, total, filename }; this.changed(this.current); }
    cancel(): void { if (this.live(this.generation)) this.move(this.generation, 'Canceled'); this.generation++; }
    get value(): FileProgress { return { ...this.current }; }
}
