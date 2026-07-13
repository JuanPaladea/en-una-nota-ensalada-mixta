// Almacenamiento de blobs de audio en IndexedDB (persiste offline entre sesiones).
const IDB_NAME = "eun_audio", IDB_STORE = "tracks";
let idbReady = null;

export function idbOpen(){
  if(idbReady) return idbReady;
  idbReady = new Promise((res, rej) => {
    try{
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }catch(e){ rej(e); }
  });
  return idbReady;
}

export async function idbPut(key, blob){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function idbGet(key){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const q = tx.objectStore(IDB_STORE).get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export async function idbDel(key){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
