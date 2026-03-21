# PHANTOM Cryptography Specification

## Key Agreement (X3DH)

PHANTOM uses **Extended Triple Diffie-Hellman (X3DH)** for initial key agreement between peers.

- **IK_A, IK_B**: Identity Keys (Ed25519 for signing, X25519 for DH).
- **SPK_B**: Signed Pre-Key.
- **OPK_B**: One-Time Pre-Key.

The shared secret is derived using:
`HKDF(DH(IK_A, SPK_B) || DH(EK_A, IK_B) || DH(EK_A, SPK_B) || DH(EK_A, OPK_B))`

## Message Encryption (Double Ratchet)

Once a session is established, the **Double Ratchet Algorithm** provides:
- **Forward Secrecy**: Compromise of current keys does not reveal past messages.
- **Break-in Recovery**: The ratchet advances with each message, recovering security even after a temporary compromise.

## Encryption Primitives

- **AEAD**: XChaCha20-Poly1305 (libsodium).
- **KDF**: HKDF-SHA512.
- **Password Hashing**: Argon2id.
