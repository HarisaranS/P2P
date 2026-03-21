import crypto from 'crypto';

export interface EncryptedMessage {
  id: string;
  conversation_id: string;
  sender_peer_id: string;
  recipient_peer_id: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  msg_number: number;
  ratchet_key: Uint8Array | null;
  timestamp: number;
  delivered?: number;
  read_at?: number | null;
  deleted?: number;
}

export class PhantomDatabase {
  private messages: EncryptedMessage[] = [];

  constructor(dbPath: string) {
    // dbPath is ignored, storing in-memory only as per strict anonymity requirements
  }

  async open(passphrase: string): Promise<void> {
    // No-op for purely in-memory. App operates without touching disk.
  }

  insertMessage(msg: EncryptedMessage): void {
    this.messages.push({
      ...msg,
      // Create copies of the buffers to avoid shared memory mutations
      ciphertext: new Uint8Array(msg.ciphertext),
      nonce: new Uint8Array(msg.nonce),
      ratchet_key: msg.ratchet_key ? new Uint8Array(msg.ratchet_key) : null,
    });
  }

  getMessages(conversationId: string, limit: number, before?: number): EncryptedMessage[] {
    let filtered = this.messages.filter(m => m.conversation_id === conversationId && !m.deleted);
    if (before) {
      filtered = filtered.filter(m => m.timestamp < before);
    }
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    return filtered.slice(0, limit);
  }

  deleteMessage(id: string): void {
    const msg = this.messages.find(m => m.id === id);
    if (msg) {
      // Soft wipe in memory
      msg.ciphertext = new Uint8Array(0);
      msg.nonce = new Uint8Array(0);
      msg.ratchet_key = null;
      msg.deleted = 1;
    }
  }

  nukeConversation(conversationId: string): void {
    // Truly drop references from memory array
    this.messages = this.messages.filter(m => m.conversation_id !== conversationId);
  }

  async nukeEverything(): Promise<void> {
    // Wipe memory
    this.messages = [];
  }

  close(): void {
    this.messages = [];
  }
}
