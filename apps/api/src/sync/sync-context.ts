import { AsyncLocalStorage } from 'async_hooks';

/** يمنع تسجيل تغيير أثناء تطبيق مزامنة واردة (تفادي حلقة لا نهائية) */
export const syncSkip = new AsyncLocalStorage<{ skip: boolean }>();

export function isSyncSkipped() {
  return !!syncSkip.getStore()?.skip;
}

export async function runWithoutSyncRecording<T>(fn: () => Promise<T>): Promise<T> {
  return syncSkip.run({ skip: true }, fn);
}
