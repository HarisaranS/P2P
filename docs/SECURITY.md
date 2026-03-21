# PHANTOM Security Model

## Threat Model

### Adversary Tiers

1.  **Local Attacker**: Access to physical device.
    - **Defense**: SQLCipher encryption with Argon2id-derived key. Private keys never stored in plaintext.
2.  **Network Attacker**: Surveillance of ISP/Local Network.
    - **Defense**: All traffic routed via Tor onion services. Peer IP addresses are never exposed. Message timing jitter and cover traffic (ORAM-style) mask communication patterns.
3.  **Nation-State / Legal**: Subpoena or large-scale interception.
    - **Defense**: Serverless architecture. No company holds user data. Peer identities are cryptographic keys, not linked to real-world identity.

## Data Sovereignty

- **Messages**: Stored only on the user's device in an encrypted SQLite database.
- **Identity**: Ed25519/X25519 keypair generated locally.
- **Logs**: No message content or metadata is ever logged.
