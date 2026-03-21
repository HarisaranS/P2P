// @ts-nocheck
import { createLibp2p, Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { autoNAT } from '@libp2p/autonat';
import { dcutr } from '@libp2p/dcutr';
import { ping } from '@libp2p/ping';
import { PhantomIdentity } from '../crypto/identity.js';

export type AnonymityMode = 'tor' | 'i2p';

export interface PhantomNodeConfig {
  identity: PhantomIdentity;
  anonymityMode: AnonymityMode;
  torSocksPort?: number;      // default 9050
  i2pSamPort?: number;        // default 7656
  listenAddresses?: string[];
  bootstrapPeers?: string[];
  enableCoverTraffic?: boolean;
  coverTrafficIntervalMs?: number;
}

export const DEFAULT_BOOTSTRAP_PEERS = [
  '/dnsaddr/bootstrap.phantom.network/p2p/12D3KooWEjHvp9rA8KGE...',
  '/ip4/178.62.45.100/tcp/4001/p2p/12D3KooWLnJKGb5K...',
];

export async function createPhantomNode(config: PhantomNodeConfig): Promise<Libp2p> {
  const transports = [
    tcp(),
    webSockets(),
    circuitRelayTransport({ discoverRelays: 3 }),
  ];

  // No WebRTC setup needed on Electron backend

  // Configure listen addresses based on anonymity mode
  let listenAddrs: string[] = [];
  if (config.anonymityMode === 'tor') {
    // Listen on localhost only — Tor handles external exposure via Onion Service
    listenAddrs = ['/ip4/127.0.0.1/tcp/0'];
  } else if (config.anonymityMode === 'i2p') {
    // Listen on localhost only
    listenAddrs = ['/ip4/127.0.0.1/tcp/0'];
  } else {
    // Direct mode — user chose to expose their IP
    listenAddrs = config.listenAddresses ?? ['/ip4/0.0.0.0/tcp/0'];
  }

  const node = await createLibp2p({
    addresses: { listen: listenAddrs },
    transports,
    connectionEncrypters: [
      noise(), // Authenticated encryption for all connections
    ],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({
        kBucketSize: 20,
        clientMode: false,
      }),
      mdns: mdns({ interval: 20000 }),
      autoNAT: autoNAT(),
      dcutr: dcutr(),
      relay: circuitRelayServer({ reservations: { maxReservations: 128 } }),
    },
  });

  return node;
}
