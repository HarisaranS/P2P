import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';

export class TorDaemon {
  private process: ChildProcess | null = null;
  private socksPort: number = 0;
  private controlPort: number = 0;
  private dataDir: string;
  private torBinaryPath: string;

  constructor() {
    let systemTor = '';
    try {
      if (process.platform !== 'win32') {
        systemTor = require('child_process').execSync('which tor').toString().trim();
      }
    } catch (e) {
      // Ignore if not found
    }

    const bundledTor = path.join(
      process.resourcesPath,
      'tor',
      process.platform === 'win32' ? 'tor.exe' : 'tor'
    );

    // Prefer system Tor in dev environments if bundled Tor is fundamentally unavailable
    this.torBinaryPath = systemTor || bundledTor;
    // Use PID-scoped data directory so multiple dev instances don't conflict
    this.dataDir = path.join(app.getPath('userData'), `tor-data-${process.pid}`);
  }

  async start(): Promise<{ socksPort: number; controlPort: number }> {
    this.socksPort = await this.findFreePort();
    this.controlPort = await this.findFreePort();

    await fs.mkdir(this.dataDir, { recursive: true });
    if (process.platform !== 'win32') {
      await fs.chmod(this.dataDir, 0o700);
    }

    const torrc = [
      `SocksPort ${this.socksPort}`,
      `ControlPort ${this.controlPort}`,
      `Log notice stderr`,
      `DisableNetwork 0`,
      `ClientOnly 1`,
      `SafeLogging 1`,
      `ExitPolicy reject *:*`,
    ].join('\n');

    const torrcPath = path.join(this.dataDir, 'torrc');
    await fs.writeFile(torrcPath, torrc, { mode: 0o600 });

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.torBinaryPath, ['-f', torrcPath], {
          stdio: 'pipe',
          env: { HOME: this.dataDir },
        });

        let bootstrapped = false;
        
        if (this.process.stderr) {
          this.process.stderr.on('data', (data: Buffer) => {
            const line = data.toString();
            if (line.includes('Bootstrapped 100%') && !bootstrapped) {
              bootstrapped = true;
              resolve({ socksPort: this.socksPort, controlPort: this.controlPort });
            }
          });
        }

        this.process.on('error', (err) => {
          reject(new Error(`Tor binary execution failed: ${err.message}. Ensure Tor is bundled in resources.`));
        });

        this.process.on('exit', (code) => {
          if (!bootstrapped && code !== 0) {
            reject(new Error(`Tor daemon exited prematurely with code ${code}.`));
          }
        });

        setTimeout(() => {
          if (!bootstrapped) {
            reject(new Error('Tor bootstrap timeout. Network connection heavily restricted or blocked.'));
          }
        }, 120_000);
      } catch (err) {
        reject(new Error(`Critical failure spawning Tor executable: ${err}`));
      }
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 2000));
      if (this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
    }
  }

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const address = srv.address();
        if (address && typeof address !== 'string') {
          const port = address.port;
          srv.close(() => resolve(port));
        } else {
          srv.close(() => reject(new Error('Invalid address')));
        }
      });
      srv.on('error', reject);
    });
  }
}
