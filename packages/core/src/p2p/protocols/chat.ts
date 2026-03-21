export interface WireEnvelope {
  version: 1;
  type: 'message' | 'delivery-receipt' | 'read-receipt' | 'typing' | 'pre-key-request' | 'pre-key-response';
  fromPeerId: string;
  toPeerId: string;
  sequenceNumber: number;
  timestamp: number;
  
  ratchetHeader: {
    dhPublicKey: string;     // base64url
    prevChainLength: number;
    messageNumber: number;
  };
  
  ciphertext: string;   // base64url
  nonce: string;        // base64url, 24 bytes
  signature: string;    // base64url, 64 bytes
}

// Handshake Protocols structure 
export interface HandshakeInitMessage {
  version: 1;
  type: 'init';
  fromPeerId: string;
  ephemeralPublicKey: string; // base64url
  usedSignedPreKeyId: number;
  usedOneTimePreKeyId: number | null;
  encryptedPayload: string;
  signature: string;
}

export interface HandshakeAckMessage {
  version: 1;
  type: 'ack';
  sessionId: string;
  initialRatchetKey: string;
  encryptedPayload: string;
  signature: string;
}
