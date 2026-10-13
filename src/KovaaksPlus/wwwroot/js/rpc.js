// Bridge to the native host (WebView2 postMessage JSON-RPC).
const pending = new Map();
const listeners = new Map();
let nextId = 1;
const host = window.chrome && window.chrome.webview;

if (host) {
  host.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.event) {
      (listeners.get(msg.event) || []).forEach((fn) => { try { fn(msg.data); } catch (err) { console.error(err); } });
      (listeners.get('*') || []).forEach((fn) => fn(msg.event, msg.data));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
  });
}

export function call(method, params = {}) {
  if (!host) return Promise.reject(new Error('Not running inside Kovaak\'s Plus'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    host.postMessage({ id, method, params });
  });
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
  return () => listeners.set(event, listeners.get(event).filter((f) => f !== fn));
}
