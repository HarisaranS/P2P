//! Cryptographic messaging core: AEAD, HKDF, and Double Ratchet.

mod aead;
mod ratchet;
mod replay;

pub use aead::{decrypt, encrypt, AeadKey};
pub use ratchet::{RatchetDecryptor, RatchetEncryptor, RatchetInit, RatchetState};
pub use replay::ReplayCache;
