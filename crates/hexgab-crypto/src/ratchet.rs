//! Signal-style Double Ratchet (simplified DH + symmetric chain).

use crate::aead::{self, AeadKey, NONCE_LEN};
use hexgab_core::{HexGabError, Result};
use hkdf::Hkdf;
use sha2::Sha256;
use std::collections::VecDeque;
use rand::rngs::OsRng;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

const ROOT_INFO: &[u8] = b"hexgab-root-v1";
const CHAIN_INFO: &[u8] = b"hexgab-chain-v1";
const MSG_KEY_INFO: &[u8] = b"hexgab-msg-v1";
const MAX_SKIP: usize = 256;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
struct ChainKey([u8; 32]);

impl ChainKey {
    fn advance(&mut self) -> AeadKey {
        let mut msg_key = [0u8; 32];
        let hk = Hkdf::<Sha256>::new(Some(&[]), &self.0);
        hk.expand(MSG_KEY_INFO, &mut msg_key)
            .expect("hkdf expand");

        let mut next = [0u8; 32];
        let hk = Hkdf::<Sha256>::new(Some(&[]), &self.0);
        hk.expand(CHAIN_INFO, &mut next).expect("hkdf expand");
        self.0 = next;
        AeadKey::from_bytes(msg_key)
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
struct DhKeypair {
    secret: StaticSecret,
    public: PublicKey,
}

pub struct RatchetState {
    root_key: [u8; 32],
    send_chain: ChainKey,
    recv_chain: ChainKey,
    send_counter: u64,
    recv_counter: u64,
    dh_self: DhKeypair,
    dh_remote: Option<PublicKey>,
    skipped: VecDeque<(u64, AeadKey)>,
}

#[derive(Clone)]
pub struct RatchetInit {
    pub root_key: [u8; 32],
    pub is_initiator: bool,
}

impl RatchetInit {
    pub fn from_shared_secret(shared: &[u8], is_initiator: bool) -> Self {
        let hk = Hkdf::<Sha256>::new(Some(ROOT_INFO), shared);
        let mut root_key = [0u8; 32];
        hk.expand(b"root", &mut root_key).expect("hkdf");
        Self {
            root_key,
            is_initiator,
        }
    }
}

fn kdf_root(root: &[u8; 32], shared: &[u8]) -> ([u8; 32], ChainKey, ChainKey) {
    let mut out = [0u8; 96];
    let hk = Hkdf::<Sha256>::new(Some(root), shared);
    hk.expand(b"ratchet-step", &mut out).expect("hkdf");
    let mut new_root = [0u8; 32];
    new_root.copy_from_slice(&out[..32]);
    let mut send = [0u8; 32];
    send.copy_from_slice(&out[32..64]);
    let mut recv = [0u8; 32];
    recv.copy_from_slice(&out[64..96]);
    (new_root, ChainKey(send), ChainKey(recv))
}

impl RatchetState {
    pub fn new(init: RatchetInit) -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&secret);

        let hk = Hkdf::<Sha256>::new(Some(ROOT_INFO), &init.root_key);
        let mut alice_send = [0u8; 32];
        let mut alice_recv = [0u8; 32];
        hk.expand(b"alice-send", &mut alice_send).expect("hkdf");
        hk.expand(b"alice-recv", &mut alice_recv).expect("hkdf");

        let (send_chain, recv_chain) = if init.is_initiator {
            (ChainKey(alice_send), ChainKey(alice_recv))
        } else {
            (ChainKey(alice_recv), ChainKey(alice_send))
        };

        Self {
            root_key: init.root_key,
            send_chain,
            recv_chain,
            send_counter: 0,
            recv_counter: 0,
            dh_self: DhKeypair {
                secret,
                public,
            },
            dh_remote: None,
            skipped: VecDeque::new(),
        }
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.dh_self.public.to_bytes()
    }

    pub fn apply_remote_dh(&mut self, remote: [u8; 32]) -> Result<()> {
        let remote_pk = PublicKey::from(remote);
        if self.dh_remote.as_ref() == Some(&remote_pk) {
            return Ok(());
        }
        let shared = self.dh_self.secret.diffie_hellman(&remote_pk);
        let (new_root, send_chain, recv_chain) =
            kdf_root(&self.root_key, shared.as_bytes());
        self.root_key = new_root;
        self.send_chain = send_chain;
        self.recv_chain = recv_chain;
        self.dh_remote = Some(remote_pk);
        // New DH key for forward secrecy
        let secret = StaticSecret::random_from_rng(OsRng);
        self.dh_self.public = PublicKey::from(&secret);
        self.dh_self.secret = secret;
        self.send_counter = 0;
        self.recv_counter = 0;
        Ok(())
    }
}

impl Drop for RatchetState {
    fn drop(&mut self) {
        self.root_key.zeroize();
        self.send_chain.zeroize();
        self.recv_chain.zeroize();
        for (_, key) in &mut self.skipped {
            key.zeroize();
        }
        self.skipped.clear();
    }
}

pub struct RatchetEncryptor<'a> {
    state: &'a mut RatchetState,
}

impl<'a> RatchetEncryptor<'a> {
    pub fn new(state: &'a mut RatchetState) -> Self {
        Self { state }
    }

    pub fn encrypt(&mut self, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        let msg_key = self.state.send_chain.advance();
        let counter = self.state.send_counter;
        self.state.send_counter += 1;

        let mut nonce = [0u8; NONCE_LEN];
        nonce[4..].copy_from_slice(&counter.to_be_bytes());

        let ciphertext = aead::encrypt(&msg_key, &nonce, plaintext, aad)?;
        let mut out = Vec::with_capacity(8 + ciphertext.len());
        out.extend_from_slice(&counter.to_be_bytes());
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }
}

pub struct RatchetDecryptor<'a> {
    state: &'a mut RatchetState,
}

impl<'a> RatchetDecryptor<'a> {
    pub fn new(state: &'a mut RatchetState) -> Self {
        Self { state }
    }

    pub fn decrypt(&mut self, data: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        if data.len() < 8 + aead::TAG_LEN {
            return Err(HexGabError::Decrypt);
        }
        let counter = u64::from_be_bytes(data[..8].try_into().unwrap());
        let ciphertext = &data[8..];

        if counter < self.state.recv_counter {
            if let Some(pos) = self.state.skipped.iter().position(|&(c, _)| c == counter) {
                let (_, mut key) = self.state.skipped.remove(pos).unwrap();
                let mut nonce = [0u8; NONCE_LEN];
                nonce[4..].copy_from_slice(&counter.to_be_bytes());
                let result = aead::decrypt(&key, &nonce, ciphertext, aad);
                key.zeroize();
                return result;
            } else {
                return Err(HexGabError::Replay);
            }
        }

        if counter > self.state.recv_counter {
            if (counter - self.state.recv_counter) as usize > MAX_SKIP {
                return Err(HexGabError::Decrypt);
            }
            while self.state.recv_counter < counter {
                let key = self.state.recv_chain.advance();
                self.state
                    .skipped
                    .push_back((self.state.recv_counter, key));
                self.state.recv_counter += 1;
            }
            while self.state.skipped.len() > MAX_SKIP {
                if let Some((_, mut old_key)) = self.state.skipped.pop_front() {
                    old_key.zeroize();
                }
            }
        }

        let msg_key = self.state.recv_chain.advance();
        self.state.recv_counter = counter + 1;

        let mut nonce = [0u8; NONCE_LEN];
        nonce[4..].copy_from_slice(&counter.to_be_bytes());
        aead::decrypt(&msg_key, &nonce, ciphertext, aad)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_messages() {
        let shared = [7u8; 32];
        let init_a = RatchetInit::from_shared_secret(&shared, true);
        let init_b = RatchetInit::from_shared_secret(&shared, false);
        let mut alice = RatchetState::new(init_a);
        let mut bob = RatchetState::new(init_b);

        let ct = RatchetEncryptor::new(&mut alice)
            .encrypt(b"hello", b"aad")
            .unwrap();
        let pt = RatchetDecryptor::new(&mut bob)
            .decrypt(&ct, b"aad")
            .unwrap();
        assert_eq!(pt, b"hello");

        let ct2 = RatchetEncryptor::new(&mut bob)
            .encrypt(b"reply", b"aad")
            .unwrap();
        let pt2 = RatchetDecryptor::new(&mut alice)
            .decrypt(&ct2, b"aad")
            .unwrap();
        assert_eq!(pt2, b"reply");
    }
}
