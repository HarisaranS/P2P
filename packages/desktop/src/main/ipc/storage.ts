import { ipcMain } from 'electron';
import { PhantomDatabase } from '@phantom/core';
import path from 'path';
import { app } from 'electron';

// Keep reference to db instance
let dbInstance: PhantomDatabase | null = null;

export function setupStorageIPC() {
  const dbPath = path.join(app.getPath('userData'), 'phantom.db');

  ipcMain.handle('storage:open', async (_, passphrase: string) => {
    if (!dbInstance) {
      dbInstance = new PhantomDatabase(dbPath);
    }
    await dbInstance.open(passphrase);
    return true;
  });

  ipcMain.handle('storage:getMessages', async (_, conversationId: string, limit: number) => {
    if (!dbInstance) throw new Error("DB not open");
    return dbInstance.getMessages(conversationId, limit);
  });

  ipcMain.handle('storage:insertMessage', async (_, msg) => {
    if (!dbInstance) throw new Error("DB not open");
    return dbInstance.insertMessage(msg);
  });

  ipcMain.handle('storage:nukeEverything', async () => {
    if (!dbInstance) throw new Error("DB not open");
    await dbInstance.nukeEverything();
    return true;
  });
}
