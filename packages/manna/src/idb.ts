/* 아주 작은 IndexedDB 도우미 — 브라우저에서 연 문서의 자동 저장(초안)과 파일 핸들을 기억한다 */

const DB = 'terrarium';
const STORES = ['drafts', 'handles'] as const;
type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((ok, fail) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
  } catch {
    return undefined; // 사생활 보호 모드 등 — 기억하지 못할 뿐이다
  }
}

export const idbGet = <T>(store: Store, key: string) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const idbPut = (store: Store, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key));
export const idbDel = (store: Store, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
