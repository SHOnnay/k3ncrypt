import type { CallSession } from './contracts';
export interface CallRepository { save(session: CallSession): Promise<void>; get(callId: string): Promise<CallSession | undefined>; delete(callId: string): Promise<void>; }
export class MemoryCallRepository implements CallRepository {
  private readonly sessions = new Map<string, CallSession>();
  async save(session: CallSession): Promise<void> { this.sessions.set(session.callId, structuredClone(session)); }
  async get(callId: string): Promise<CallSession | undefined> { const value = this.sessions.get(callId); return value ? structuredClone(value) : undefined; }
  async delete(callId: string): Promise<void> { this.sessions.delete(callId); }
}
