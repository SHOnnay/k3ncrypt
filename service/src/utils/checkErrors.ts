/**
 * M3c: call/verification failures carry a stable code, so the client classifies them by code
 * and user-facing wording can change without breaking classification. Message text is for logs.
 */
export type CheckErrorCode = 'VERIFICATION_REQUIRED' | 'PINNED_IDENTITY_CHANGED';
export const checkError = (code: CheckErrorCode, message: string): Error & { safeDiagnosticCode: CheckErrorCode } =>
    Object.assign(new Error(message), { safeDiagnosticCode: code });
export const checkRequired = (message: string) => checkError('VERIFICATION_REQUIRED', message);
export const numberChanged = (message: string) => checkError('PINNED_IDENTITY_CHANGED', message);
