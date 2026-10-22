/*
 * Steadfast takeoff: saving in the browser and to files.
 * The current job lives in localStorage; drawings live in IndexedDB, keyed by file name.
 */
(function () {
  'use strict';

  const JOB_KEY = 'steadfast-takeoff.current-job';
  const DB_NAME = 'steadfast-takeoff';
  const STORE = 'drawings';

  function loadJob() {
    try {
      const text = localStorage.getItem(JOB_KEY);
      return text ? JSON.parse(text) : null;
    } catch (e) {
      return null;
    }
  }

  function saveJob(est) {
    try {
      localStorage.setItem(JOB_KEY, JSON.stringify(est));
      return true;
    } catch (e) {
      return false;
    }
  }

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    }));
  }

  // Drawings are stored as { name, type, data: ArrayBuffer, added }.
  function putDrawing(name, type, data) {
    return tx('readwrite', s => s.put({ name, type, data, added: new Date().toISOString() }));
  }

  function getDrawing(name) {
    return tx('readonly', s => s.get(name)).catch(() => null);
  }

  // Save a text file. Uses the Chrome save dialog when it is there, else a download.
  async function saveTextFile(fileName, text) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Estimate file', accept: { 'application/json': ['.json'] } }]
        });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return handle.name;
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        // Fall through to a download if the dialog is not allowed here
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  }

  window.SteadfastStorage = { loadJob, saveJob, putDrawing, getDrawing, saveTextFile };
})();
