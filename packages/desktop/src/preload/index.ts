import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('phantom', {
  crypto: {
    generateIdentity: () => ipcRenderer.invoke('crypto:generateIdentity'),
    encryptMessage: (args: any) => ipcRenderer.invoke('crypto:encryptMessage', args),
    decryptMessage: (args: any) => ipcRenderer.invoke('crypto:decryptMessage', args),
  },
  p2p: {
    start: (config: any) => ipcRenderer.invoke('p2p:start', config),
    sendMessage: (args: any) => ipcRenderer.invoke('p2p:sendMessage', args),
    getStatus: () => ipcRenderer.invoke('p2p:getStatus'),
    getAddresses: () => ipcRenderer.invoke('p2p:getAddresses'),
    onMessage: (callback: any) => {
      // Remove any existing listeners to prevent duplicates
      ipcRenderer.removeAllListeners('p2p:message');
      ipcRenderer.on('p2p:message', (_, msg) => callback(msg));
    },
    onPeers: (callback: any) => {
      ipcRenderer.removeAllListeners('p2p:peers');
      ipcRenderer.on('p2p:peers', (_, count) => callback(count));
    }
  },
  storage: {
    getMessages: (args: any) => ipcRenderer.invoke('storage:getMessages', args),
  },
  onTorStatus: (callback: any) => ipcRenderer.on('tor:status', (_, value) => callback(value)),
  getTorStatus: () => ipcRenderer.invoke('tor:getStatus'),
});
