import sodium from 'libsodium-wrappers-sumo';
import { PhantomIdentity } from './identity.js';

export interface PreKeyBundle {
  peerId: string;
  identityPublicKey: string; // base64url
  signedPreKey: {
    id: number;
    publicKey: string; // base64url
    signature: string; // base64url
  };
  oneTimePreKeys: Array<{
    id: number;
    publicKey: string; // base64url
  }>;
}

export interface EncryptedSessionState {
  rootKey: string;
  sendChainKey: string | null;
  recvChainKey: string | null;
  sendMsgNumber: number;
  recvMsgNumber: number;
  prevSendChainLength: number;
  dhPublicKey: string;
  dhPrivateKey: string;
  theirDHPublicKey: string | null;
  skippedMessageKeys: Record<string, string>; // base64url map
}

export interface EncryptedEnvelope {
  ratchetHeader: {
    dhPublicKey: string; // base64url
    prevChainLength: number;
    messageNumber: number;
  };
  ciphertext: string; // base64url
  nonce: string; // base64url
}

// HKDF-SHA512
// Using WebCrypto for standardization and speed
async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as any as BufferSource, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data as any as BufferSource);
  return new Uint8Array(signature);
}

export async function hkdfSha512(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  // Extract
  const prk = await hmacSha512(salt, ikm);
  
  // Expand
  const okm = new Uint8Array(length);
  let t = new Uint8Array(0);
  let generatedBytes = 0;
  let blockIndex = 1;
  const tArr = [];
  
  while (generatedBytes < length) {
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t, 0);
    input.set(info, t.length);
    input.set([blockIndex], t.length + info.length);
    
    t = new Uint8Array(await hmacSha512(prk, input));
    tArr.push(t);
    generatedBytes += t.length;
    blockIndex++;
  }
  
  let offset = 0;
  for (const block of tArr) {
    okm.set(block.slice(0, Math.min(block.length, length - offset)), offset);
    offset += block.length;
    if (offset >= length) break;
  }
  
  return okm;
}

export async function x3dhInitiate(
  localIdentity: PhantomIdentity,
  recipientBundle: PreKeyBundle
): Promise<{ sharedSecret: Uint8Array; usedPreKeyId: number | null; ephemeralPublicKey: Uint8Array }> {
  await sodium.ready;

  // 1. Generate ephemeral keypair EK_A
  const ephemeralKeyPair = sodium.crypto_box_keypair();

  const recipientIK = sodium.from_base64(recipientBundle.identityPublicKey, sodium.base64_variants.URLSAFE_NO_PADDING);
  const recipientSPK = sodium.from_base64(recipientBundle.signedPreKey.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING);

  // DH1 = DH(IK_A, SPK_B)
  const dh1 = sodium.crypto_scalarmult(localIdentity.dhKeyPair.privateKey, recipientSPK);
  // DH2 = DH(EK_A, IK_B)
  const dh2 = sodium.crypto_scalarmult(ephemeralKeyPair.privateKey, recipientIK);
  // DH3 = DH(EK_A, SPK_B)
  const dh3 = sodium.crypto_scalarmult(ephemeralKeyPair.privateKey, recipientSPK);

  // DH4 = DH(EK_A, OPK_B) if OPK available
  let dh4 = new Uint8Array(0);
  let usedPreKeyId: number | null = null;
  
  if (recipientBundle.oneTimePreKeys && recipientBundle.oneTimePreKeys.length > 0) {
    const opk = recipientBundle.oneTimePreKeys[0];
    const opkPub = sodium.from_base64(opk.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING);
    dh4 = new Uint8Array(sodium.crypto_scalarmult(ephemeralKeyPair.privateKey, opkPub));
    usedPreKeyId = opk.id;
  }

  // Combine DH outputs securely
  // F = 32 bytes of 0xFF
  const F = new Uint8Array(32).fill(0xff);
  const kmInfo = new TextEncoder().encode('PhantomX3DH');
  
  const kmInput = new Uint8Array(F.length + dh1.length + dh2.length + dh3.length + dh4.length);
  kmInput.set(F, 0);
  kmInput.set(dh1, F.length);
  kmInput.set(dh2, F.length + dh1.length);
  kmInput.set(dh3, F.length + dh1.length + dh2.length);
  kmInput.set(dh4, F.length + dh1.length + dh2.length + dh3.length);

  // HKDF-SHA512
  const sharedSecret = await hkdfSha512(kmInput, new Uint8Array(32), kmInfo, 32);

  return { sharedSecret, usedPreKeyId, ephemeralPublicKey: ephemeralKeyPair.publicKey };
}

const ROOT_KDF_INFO = new TextEncoder().encode('PhantomRoot');
const CHAIN_KDF_INFO = new TextEncoder().encode('PhantomChain');

export class DoubleRatchetSession {
  private rootKey: Uint8Array;
  private sendChainKey: Uint8Array | null = null;
  private recvChainKey: Uint8Array | null = null;
  
  private sendMsgNumber: number = 0;
  private recvMsgNumber: number = 0;
  private prevSendChainLength: number = 0;
  
  private dhKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  private theirDHPublicKey: Uint8Array | null = null;
  
  private skippedMessageKeys: Map<string, Uint8Array> = new Map();
  private readonly MAX_SKIP = 1000;

  constructor(sharedSecret: Uint8Array, localDHKeyPair?: { publicKey: Uint8Array; privateKey: Uint8Array }) {
    this.rootKey = sharedSecret;
    // Initial DR setup assumes we have local keys
    if (localDHKeyPair) {
      this.dhKeyPair = localDHKeyPair;
    } else {
      this.dhKeyPair = sodium.crypto_box_keypair();
    }
  }

  // Initiator initialization
  static async initAlice(sharedSecret: Uint8Array, bobDHPublicKey: Uint8Array): Promise<DoubleRatchetSession> {
    const localDH = sodium.crypto_box_keypair();
    const session = new DoubleRatchetSession(sharedSecret, localDH);
    
    // Alice performs DR init using Bob's dh public key (SPK)
    session.theirDHPublicKey = bobDHPublicKey;
    const dhOut = sodium.crypto_scalarmult(session.dhKeyPair.privateKey, session.theirDHPublicKey);
    const kdfOut = await hkdfSha512(dhOut, session.rootKey, ROOT_KDF_INFO, 64);
    session.rootKey = kdfOut.slice(0, 32);
    session.sendChainKey = kdfOut.slice(32, 64);
    
    return session;
  }

  // Responder initialization
  static async initBob(sharedSecret: Uint8Array, localDHKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array }): Promise<DoubleRatchetSession> {
    return new DoubleRatchetSession(sharedSecret, localDHKeyPair);
  }

  async encrypt(plaintext: string): Promise<EncryptedEnvelope> {
    if (!this.sendChainKey) {
      throw new Error("Cannot send: sendChainKey not established");
    }

    const { nextChainKey, messageKey } = await this.chainKeyStep(this.sendChainKey);
    this.sendChainKey = nextChainKey;

    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ptBytes = new TextEncoder().encode(plaintext);

    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ptBytes, null, null, nonce, messageKey);

    const env: EncryptedEnvelope = {
      ratchetHeader: {
        dhPublicKey: sodium.to_base64(this.dhKeyPair.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING),
        prevChainLength: this.prevSendChainLength,
        messageNumber: this.sendMsgNumber
      },
      ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.URLSAFE_NO_PADDING),
      nonce: sodium.to_base64(nonce, sodium.base64_variants.URLSAFE_NO_PADDING)
    };

    this.sendMsgNumber++;
    return env;
  }

  async decrypt(envelope: EncryptedEnvelope): Promise<string> {
    const theirDHPublicKey = sodium.from_base64(envelope.ratchetHeader.dhPublicKey, sodium.base64_variants.URLSAFE_NO_PADDING);
    const msgNum = envelope.ratchetHeader.messageNumber;
    
    const mkKey = `${sodium.to_hex(theirDHPublicKey)}_${msgNum}`;
    
    let messageKey: Uint8Array;

    if (this.skippedMessageKeys.has(mkKey)) {
      messageKey = this.skippedMessageKeys.get(mkKey)!;
      this.skippedMessageKeys.delete(mkKey);
    } else {
      if (this.theirDHPublicKey && sodium.compare(theirDHPublicKey, this.theirDHPublicKey) !== 0) {
        // DH Ratchet step needed
        await this.skipMessageKeys(envelope.ratchetHeader.prevChainLength);
        await this.dhRatchetStep(theirDHPublicKey);
      }
      
      await this.skipMessageKeys(msgNum);
      
      if (!this.recvChainKey) throw new Error("recvChainKey not initialized");
      
      const step = await this.chainKeyStep(this.recvChainKey);
      this.recvChainKey = step.nextChainKey;
      messageKey = step.messageKey;
      this.recvMsgNumber++;
    }

    const nonceBytes = sodium.from_base64(envelope.nonce, sodium.base64_variants.URLSAFE_NO_PADDING);
    const ctBytes = sodium.from_base64(envelope.ciphertext, sodium.base64_variants.URLSAFE_NO_PADDING);

    const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ctBytes, null, nonceBytes, messageKey);
    return new TextDecoder().decode(decrypted);
  }

  private async skipMessageKeys(until: number) {
    if (this.recvMsgNumber + this.MAX_SKIP < until) {
      throw new Error("Too many skipped messages");
    }
    if (this.recvChainKey && this.theirDHPublicKey) {
      while (this.recvMsgNumber < until) {
        const step = await this.chainKeyStep(this.recvChainKey);
        this.recvChainKey = step.nextChainKey;
        const key = `${sodium.to_hex(this.theirDHPublicKey)}_${this.recvMsgNumber}`;
        this.skippedMessageKeys.set(key, step.messageKey);
        
        // Evict oldest if exceeding MAX_SKIP locally just for safety
        if (this.skippedMessageKeys.size > this.MAX_SKIP) {
          const firstKey = this.skippedMessageKeys.keys().next().value;
          if (firstKey) this.skippedMessageKeys.delete(firstKey);
        }
        this.recvMsgNumber++;
      }
    }
  }

  private async dhRatchetStep(theirDHPublicKey: Uint8Array) {
    this.prevSendChainLength = this.sendMsgNumber;
    this.sendMsgNumber = 0;
    this.recvMsgNumber = 0;
    this.theirDHPublicKey = theirDHPublicKey;

    // Receive
    const dhRecv = sodium.crypto_scalarmult(this.dhKeyPair.privateKey, this.theirDHPublicKey);
    const kdfRecv = await hkdfSha512(dhRecv, this.rootKey, ROOT_KDF_INFO, 64);
    this.rootKey = kdfRecv.slice(0, 32);
    this.recvChainKey = kdfRecv.slice(32, 64);

    // Turnaround - Generate new local DH pair
    this.dhKeyPair = sodium.crypto_box_keypair();
    const dhSend = sodium.crypto_scalarmult(this.dhKeyPair.privateKey, this.theirDHPublicKey);
    const kdfSend = await hkdfSha512(dhSend, this.rootKey, ROOT_KDF_INFO, 64);
    this.rootKey = kdfSend.slice(0, 32);
    this.sendChainKey = kdfSend.slice(32, 64);
  }

  private async chainKeyStep(chainKey: Uint8Array) {
    // HMAC based chain step:
    // Message key = HMAC-SHA512(chainKey, 0x01)
    // Next chain key = HMAC-SHA512(chainKey, 0x02)
    const msgMac = await hkdfSha512(new Uint8Array([0x01]), chainKey, CHAIN_KDF_INFO, 32);
    const nextChainKey = await hkdfSha512(new Uint8Array([0x02]), chainKey, CHAIN_KDF_INFO, 32);
    return { nextChainKey, messageKey: msgMac };
  }

  serialize(): EncryptedSessionState {
    const skippedRecord: Record<string, string> = {};
    for (const [k, v] of this.skippedMessageKeys.entries()) {
      skippedRecord[k] = sodium.to_base64(v, sodium.base64_variants.URLSAFE_NO_PADDING);
    }
    
    return {
      rootKey: sodium.to_base64(this.rootKey, sodium.base64_variants.URLSAFE_NO_PADDING),
      sendChainKey: this.sendChainKey ? sodium.to_base64(this.sendChainKey, sodium.base64_variants.URLSAFE_NO_PADDING) : null,
      recvChainKey: this.recvChainKey ? sodium.to_base64(this.recvChainKey, sodium.base64_variants.URLSAFE_NO_PADDING) : null,
      sendMsgNumber: this.sendMsgNumber,
      recvMsgNumber: this.recvMsgNumber,
      prevSendChainLength: this.prevSendChainLength,
      dhPublicKey: sodium.to_base64(this.dhKeyPair.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING),
      dhPrivateKey: sodium.to_base64(this.dhKeyPair.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING),
      theirDHPublicKey: this.theirDHPublicKey ? sodium.to_base64(this.theirDHPublicKey, sodium.base64_variants.URLSAFE_NO_PADDING) : null,
      skippedMessageKeys: skippedRecord
    };
  }

  static deserialize(state: EncryptedSessionState): DoubleRatchetSession {
    const session = new DoubleRatchetSession(
      sodium.from_base64(state.rootKey, sodium.base64_variants.URLSAFE_NO_PADDING)
    );
    session.sendChainKey = state.sendChainKey ? sodium.from_base64(state.sendChainKey, sodium.base64_variants.URLSAFE_NO_PADDING) : null;
    session.recvChainKey = state.recvChainKey ? sodium.from_base64(state.recvChainKey, sodium.base64_variants.URLSAFE_NO_PADDING) : null;
    session.sendMsgNumber = state.sendMsgNumber;
    session.recvMsgNumber = state.recvMsgNumber;
    session.prevSendChainLength = state.prevSendChainLength;
    session.dhKeyPair = {
      publicKey: sodium.from_base64(state.dhPublicKey, sodium.base64_variants.URLSAFE_NO_PADDING),
      privateKey: sodium.from_base64(state.dhPrivateKey, sodium.base64_variants.URLSAFE_NO_PADDING)
    };
    session.theirDHPublicKey = state.theirDHPublicKey ? sodium.from_base64(state.theirDHPublicKey, sodium.base64_variants.URLSAFE_NO_PADDING) : null;
    
    for (const [k, v] of Object.entries(state.skippedMessageKeys)) {
      session.skippedMessageKeys.set(k, sodium.from_base64(v, sodium.base64_variants.URLSAFE_NO_PADDING));
    }
    
    return session;
  }
}
