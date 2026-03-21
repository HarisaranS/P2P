import sodium from 'libsodium-wrappers-sumo';
import { argon2id } from 'hash-wasm';
import { keys } from '@libp2p/crypto';
import { peerIdFromPublicKey } from '@libp2p/peer-id';

export interface SignedPreKey {
  id: number;
  keyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  signature: Uint8Array;
}

export interface OneTimePreKey {
  id: number;
  keyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
}

export interface PhantomIdentity {
  signingKeyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  dhKeyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  signedPreKey: {
    id: number;
    publicKey: Uint8Array;
    signature: Uint8Array;
  };
  oneTimePreKeys: Array<{
    id: number;
    publicKey: Uint8Array;
  }>;
  peerId: string;
  createdAt: number;
  safetyNumber: string;
}

export interface EncryptedIdentityBackup {
  salt: string; // hex
  nonce: string; // hex
  ciphertext: string; // hex
}

function getRandomId(): number {
  return sodium.randombytes_uniform(0x7fffffff);
}

export async function generateIdentity(): Promise<PhantomIdentity> {
  await sodium.ready;

  // 1. Generate Ed25519 signing keypair via libsodium
  const signingKeyPair = sodium.crypto_sign_keypair();

  // 2. Generate X25519 DH keypair  
  const dhKeyPair = sodium.crypto_box_keypair();

  // 3. Generate Signed Pre-Key (X25519)
  const spkId = getRandomId();
  const spkKeyPair = sodium.crypto_box_keypair();
  const spkSignature = sodium.crypto_sign_detached(spkKeyPair.publicKey, signingKeyPair.privateKey);

  // 4. Generate 100 One-Time Pre-Keys (X25519)
  const oneTimePreKeys = [];
  for (let i = 0; i < 100; i++) {
    const opkId = getRandomId();
    const opkKeyPair = sodium.crypto_box_keypair();
    oneTimePreKeys.push({ id: opkId, publicKey: opkKeyPair.publicKey });
  }

  // 5. Generate a proper Libp2p PeerId using @libp2p/crypto Ed25519
  //    This generates a fresh Ed25519 key registered as a valid multiaddr peer identity
  const libp2pKey = await keys.generateKeyPair('Ed25519');
  const peerId = peerIdFromPublicKey(libp2pKey.publicKey).toString();

  // 6. Compute Safety Number
  const safetyNumber = computeSafetyNumber(signingKeyPair.publicKey, signingKeyPair.publicKey);

  return {
    signingKeyPair: {
      publicKey: signingKeyPair.publicKey,
      privateKey: signingKeyPair.privateKey,
    },
    dhKeyPair: {
      publicKey: dhKeyPair.publicKey,
      privateKey: dhKeyPair.privateKey,
    },
    signedPreKey: {
      id: spkId,
      publicKey: spkKeyPair.publicKey,
      signature: spkSignature,
    },
    oneTimePreKeys,
    peerId,
    createdAt: Date.now(),
    safetyNumber,
  };
}

export function computeSafetyNumber(localPubKey: Uint8Array, remotePubKey: Uint8Array): string {
  // Sort keys to ensure both parties compute the exact same number regardless of who initiated
  const sorted = [localPubKey, remotePubKey].sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  });

  const combined = new Uint8Array(sorted[0].length + sorted[1].length);
  combined.set(sorted[0]);
  combined.set(sorted[1], sorted[0].length);

  const hash = sodium.crypto_generichash(64, combined, null);
  // Get first 30 bytes for safety number (60 digits if converted modulo 10 directly, but base 10 padding is better)
  const digits = Array.from(hash.slice(0, 30))
    .map((b) => (b % 100).toString(10).padStart(2, '0'))
    .join('');
  
  return digits.slice(0, 60);
}

export async function exportIdentity(
  identity: PhantomIdentity,
  passphrase: string
): Promise<EncryptedIdentityBackup> {
  await sodium.ready;
  const salt = sodium.randombytes_buf(32);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

  // Argon2id key derivation using hash-wasm
  const keyHex = await argon2id({
    password: passphrase,
    salt,
    parallelism: 2,
    iterations: 4,
    memorySize: 262144, // 256 MB (as required)
    hashLength: sodium.crypto_secretbox_KEYBYTES,
    outputType: 'hex',
  });

  const key = sodium.from_hex(keyHex);

  // Serialize identity
  // Note: we must convert Uint8Arrays to base64 or hex for JSON
  const replacer = (key: string, value: any) => 
    value instanceof Uint8Array ? sodium.to_hex(value) : value;

  const plaintext = new TextEncoder().encode(JSON.stringify(identity, replacer));

  // Encrypt using XChaCha20-Poly1305 (libsodium secretbox uses XSalsa20, we use AEAD XChaCha20-Poly1305)
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    key
  );

  return {
    salt: sodium.to_hex(salt),
    nonce: sodium.to_hex(nonce),
    ciphertext: sodium.to_hex(ciphertext)
  };
}

export async function importIdentity(
  backup: EncryptedIdentityBackup,
  passphrase: string
): Promise<PhantomIdentity> {
  await sodium.ready;

  const salt = sodium.from_hex(backup.salt);
  const nonce = sodium.from_hex(backup.nonce);
  const ciphertext = sodium.from_hex(backup.ciphertext);

  const keyHex = await argon2id({
    password: passphrase,
    salt,
    parallelism: 2,
    iterations: 4,
    memorySize: 262144,
    hashLength: sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    outputType: 'hex',
  });

  const key = sodium.from_hex(keyHex);

  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    key
  );

  const jsonStr = new TextDecoder().decode(plaintext);
  
  const reviver = (key: string, value: any) => 
    typeof value === 'string' && /^[0-9a-f]+$/i.test(value) && 
    (key === 'publicKey' || key === 'privateKey' || key === 'signature') 
      ? sodium.from_hex(value) 
      : value;

  return JSON.parse(jsonStr, reviver) as PhantomIdentity;
}

export function zeroMemory(buf: Uint8Array): void {
  // Use crypto.getRandomValues to overwrite with random bytes first
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    // node fallback or rely on sodium.memzero
    sodium.memzero(buf);
  }
  buf.fill(0);
}
