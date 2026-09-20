import type { CallPermissions, PermissionState } from './contracts';
const allowed: Record<PermissionState, PermissionState[]> = { unknown: ['requested'], requested: ['granted', 'denied'], granted: ['active', 'released'], active: ['released'], released: ['requested'], denied: ['requested'] };
export const transitionPermission = (permissions: CallPermissions, device: keyof CallPermissions, next: PermissionState): CallPermissions => {
  if (!allowed[permissions[device]].includes(next)) throw new Error(`Invalid ${device} permission transition.`);
  return { ...permissions, [device]: next };
};
export const initialCallPermissions = (): CallPermissions => ({ microphone: 'unknown', camera: 'unknown' });
