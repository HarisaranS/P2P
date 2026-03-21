import { ipcMain } from 'electron';
import { generateIdentity, exportIdentity, importIdentity, PhantomIdentity } from '@phantom/core';

export function setupCryptoIPC() {
  ipcMain.handle('crypto:generateIdentity', async () => {
    return await generateIdentity();
  });

  ipcMain.handle('crypto:exportIdentity', async (_, identity: PhantomIdentity, passphrase: string) => {
    return await exportIdentity(identity, passphrase);
  });

  ipcMain.handle('crypto:importIdentity', async (_, backup, passphrase: string) => {
    return await importIdentity(backup, passphrase);
  });

  // Adding basic encrypt/decrypt shims if needed, but true DR state is complex 
  // and usually handled within the core background service, keeping keys out of renderer entirely.
  // The renderer should only ask the background to "send msg" and background encrypts it.
}
