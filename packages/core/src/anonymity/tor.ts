// @ts-nocheck
import { SocksProxyAgent } from 'socks-proxy-agent';
import { fetch } from 'undici';

export interface TorConfig {
  socksPort: number;
}

export class TorAnonymityProvider {
  private agent: SocksProxyAgent;

  constructor(config: TorConfig) {
    this.agent = new SocksProxyAgent(`socks://127.0.0.1:${config.socksPort}`);
  }

  // Example of using Tor for an external request (e.g. fetching DHT bootstraps if needed)
  async fetchAnonymously(url: string) {
    const response = await fetch(url, {
      dispatcher: this.agent as any,
    });
    return response.json();
  }

  getAgent() {
    return this.agent;
  }
}
