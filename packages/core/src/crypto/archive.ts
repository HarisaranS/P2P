import sodium from 'libsodium-wrappers-sumo';
import { PhantomIdentity } from './identity.js';
import { argon2id } from 'hash-wasm';

export interface ExportOptions {
  conversationWith: string; // peerId
}

export interface VerifiedArchive {
  exportedBy: string;
  exportedAt: number;
  conversationWith: string;
  messages: any[];
  messageCount: number;
  merkleRoot: string;
}

const MAGIC = new TextEncoder().encode('PHANTOM_ARCHIVE\x01');
const VERSION = 1;

function buildMerkleTree(messages: any[]): string {
  if (messages.length === 0) {
    const emptyHash = sodium.crypto_generichash(32, new Uint8Array(0), null);
    return sodium.to_hex(emptyHash);
  }

  // Hash each message (JSON stringified)
  let layer: Uint8Array[] = messages.map(msg => 
    sodium.crypto_generichash(32, new TextEncoder().encode(JSON.stringify(msg)), null)
  );

  while (layer.length > 1) {
    const nextLayer: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        const combined = new Uint8Array(64);
        combined.set(layer[i], 0);
        combined.set(layer[i + 1], 32);
        nextLayer.push(sodium.crypto_generichash(32, combined, null));
      } else {
        // Odd number of nodes, carry over or duplicate. We carry over.
        nextLayer.push(layer[i]);
      }
    }
    layer = nextLayer;
  }

  return sodium.to_hex(layer[0]);
}

export async function exportConversation(
  messages: any[],
  localIdentity: PhantomIdentity,
  passphrase: string,
  options: ExportOptions
): Promise<Uint8Array> {
  await sodium.ready;

  const merkleRoot = buildMerkleTree(messages);

  const payload = {
    exportedBy: localIdentity.peerId,
    exportedAt: Date.now(),
    conversationWith: options.conversationWith,
    messages,
    messageCount: messages.length,
    merkleRoot,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  const archiveId = sodium.randombytes_buf(32);
  const salt = sodium.randombytes_buf(32);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  // Argon2id KDF
  const keyHex = await argon2id({
    password: passphrase,
    salt,
    parallelism: 2,
    iterations: 4,
    memorySize: 262144, // 256MB
    hashLength: sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    outputType: 'hex',
  });
  const key = sodium.from_hex(keyHex);

  const ciphertextWithTag = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payloadBytes,
    null,
    null,
    nonce,
    key
  );

  // Data structure before signature:
  // 16(Magic) + 4(Version) + 32(ID) + 8(Timestamp) + 32(Salt) + 24(Nonce) + C(Ciphertext+Tag)
  const unsignedLen = 16 + 4 + 32 + 8 + 32 + 24 + ciphertextWithTag.length;
  const unsignedArchive = new Uint8Array(unsignedLen);
  
  let offset = 0;
  unsignedArchive.set(MAGIC, offset); offset += 16;
  
  const view = new DataView(unsignedArchive.buffer);
  view.setUint32(offset, VERSION, false); offset += 4;
  
  unsignedArchive.set(archiveId, offset); offset += 32;
  
  // BigInt for 64-bit timestamp
  view.setBigUint64(offset, BigInt(payload.exportedAt), false); offset += 8;
  
  unsignedArchive.set(salt, offset); offset += 32;
  unsignedArchive.set(nonce, offset); offset += 24;
  unsignedArchive.set(ciphertextWithTag, offset); offset += ciphertextWithTag.length;

  const signature = sodium.crypto_sign_detached(unsignedArchive, localIdentity.signingKeyPair.privateKey);

  const finalArchive = new Uint8Array(unsignedLen + 64);
  finalArchive.set(unsignedArchive, 0);
  finalArchive.set(signature, unsignedLen);

  return finalArchive;
}

export async function importAndVerifyArchive(
  archiveBytes: Uint8Array,
  passphrase: string,
  exporterPublicKey: Uint8Array
): Promise<VerifiedArchive> {
  await sodium.ready;

  if (archiveBytes.length < 16 + 4 + 32 + 8 + 32 + 24 + 16 + 64) {
    throw new Error('Archive is too short or malformed');
  }

  const unsignedLen = archiveBytes.length - 64;
  const unsignedArchive = archiveBytes.slice(0, unsignedLen);
  const signature = archiveBytes.slice(unsignedLen);

  const isValidSignature = sodium.crypto_sign_verify_detached(signature, unsignedArchive, exporterPublicKey);
  if (!isValidSignature) {
    throw new Error('Archive signature verification failed! Archive has been tampered with or is from a different identity.');
  }

  let offset = 0;
  const magic = unsignedArchive.slice(0, 16);
  if (sodium.to_string(magic) !== sodium.to_string(MAGIC)) {
    throw new Error('Invalid magic bytes');
  }
  offset += 16;

  const view = new DataView(unsignedArchive.buffer);
  const version = view.getUint32(offset, false);
  if (version !== 1) {
    throw new Error('Unsupported archive version');
  }
  offset += 4;

  const archiveId = unsignedArchive.slice(offset, offset + 32); offset += 32;
  const timestamp = view.getBigUint64(offset, false); offset += 8;
  
  const salt = unsignedArchive.slice(offset, offset + 32); offset += 32;
  const nonce = unsignedArchive.slice(offset, offset + 24); offset += 24;
  const ciphertextWithTag = unsignedArchive.slice(offset);

  const keyHex = await argon2id({
    password: passphrase,
    salt,
    parallelism: 2,
    iterations: 4,
    memorySize: 262144, // 256MB
    hashLength: sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    outputType: 'hex',
  });
  const key = sodium.from_hex(keyHex);

  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertextWithTag,
      null,
      nonce,
      key
    );
  } catch (err) {
    throw new Error('Failed to decrypt archive. Incorrect passphrase or corrupted data.');
  }

  const payloadStr = new TextDecoder().decode(plaintext);
  const payload = JSON.parse(payloadStr) as VerifiedArchive;

  // Verify Merkle Root
  const computedMerkleRoot = buildMerkleTree(payload.messages);
  if (computedMerkleRoot !== payload.merkleRoot) {
    throw new Error('Merkle root mismatch! The message list has been tampered with.');
  }

  if (payload.messages.length !== payload.messageCount) {
    throw new Error('Message count mismatch! The message list has been tampered with.');
  }

  return payload;
}
