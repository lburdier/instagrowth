// Pont minimal et sûr entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('igg', {
  call: (method, ...args) => ipcRenderer.invoke('igg', method, args),
  on: (fn) => {
    const handler = (_e, ev) => fn(ev);
    ipcRenderer.on('igg-event', handler);
    return () => ipcRenderer.removeListener('igg-event', handler);
  },
});
