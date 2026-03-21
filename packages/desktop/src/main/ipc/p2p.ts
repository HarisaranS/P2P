import { ipcMain, BrowserWindow } from 'electron';
import { createPhantomNode, PhantomNodeConfig } from '@phantom/core';
import { Libp2p } from 'libp2p';
import { peerIdFromString } from '@libp2p/peer-id';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';

let p2pNode: Libp2p | null = null;

export function setupP2PIPC() {
  ipcMain.handle('p2p:start', async (_, config: PhantomNodeConfig) => {
    if (p2pNode) {
      await p2pNode.stop();
    }
    p2pNode = await createPhantomNode(config);

    // Register incoming chat protocol handler using libp2p 3.x MessageStream interface
    p2pNode.handle('/phantom/chat/1.0.0', async (stream: any, connection: any) => {
      try {
        // In libp2p 3.x, Stream is an AsyncIterable<Uint8Array>
        for await (const chunk of stream) {
          try {
            // chunk can be Uint8Array or Uint8ArrayList
            const buf = chunk.subarray ? chunk.subarray() : Buffer.from(chunk);
            const payload = uint8ArrayToString(buf);
            const parsed = JSON.parse(payload);
            
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              windows[0].webContents.send('p2p:message', {
                ...parsed,
                senderId: connection.remotePeer.toString()
              });
            }
          } catch (e) {
            console.warn('Failed to parse incoming packet', e);
          }
        }
      } catch (err) {
        console.error('Stream handler fatal error', err);
      }
    });

    await p2pNode.start();

    // Broadcast live peer count 
    const peerCountInterval = setInterval(() => {
      if (!p2pNode) { clearInterval(peerCountInterval); return; }
      const count = p2pNode.getConnections().length;
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('p2p:peers', count)
      );
    }, 3000);

    return true;
  });

  ipcMain.handle('p2p:stop', async () => {
    if (p2pNode) {
      await p2pNode.stop();
      p2pNode = null;
    }
    return true;
  });

  ipcMain.handle('p2p:getStatus', async () => {
    if (!p2pNode) return { status: 'stopped', peers: 0 };
    return { status: 'running', peers: p2pNode.getConnections().length };
  });

  ipcMain.handle('p2p:getAddresses', async () => {
    if (!p2pNode) return [];
    return p2pNode.getMultiaddrs().map((ma: any) => ma.toString());
  });

  ipcMain.handle('p2p:sendMessage', async (_, args: { to: string, text: string }) => {
    if (!p2pNode) throw new Error('P2P Node not running');

    try {
      let dialTarget: any;
      if (args.to.startsWith('/')) {
        const { multiaddr } = await import('@multiformats/multiaddr');
        dialTarget = multiaddr(args.to);
      } else {
        dialTarget = peerIdFromString(args.to);
      }

      const stream: any = await p2pNode.dialProtocol(dialTarget, '/phantom/chat/1.0.0');

      const payload = JSON.stringify({
        text: args.text,
        timestamp: Date.now()
      });

      // libp2p 3.x native send() method
      stream.send(uint8ArrayFromString(payload));
      
      // Close the writable end to flush and signal completion
      await stream.close();

      return { success: true };
    } catch (err) {
      console.error('Failed to dial/send:', err);
      throw err;
    }
  });
}
