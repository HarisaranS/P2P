//! SPAKE2 pairing handshake with key confirmation.

use hexgab_core::{HexGabError, Result};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::Rng;
use sha2::Sha256;
use spake2::{Identity, Password, Spake2};
use zeroize::{Zeroize, ZeroizeOnDrop};

type ConfirmMac = Hmac<Sha256>;

const SESSION_INFO: &[u8] = b"hexgab-session-v1";
const CONFIRM_INFO: &[u8] = b"hexgab-confirm-v1";

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SharedSessionKey {
    key: [u8; 32],
}

impl SharedSessionKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }
}

pub fn generate_pairing_code() -> String {
    const CHARSET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

pub fn short_auth_code(shared: &[u8]) -> String {
    let mut mac = ConfirmMac::new_from_slice(shared).expect("hmac key");
    Mac::update(&mut mac, CONFIRM_INFO);
    let tag = mac.finalize().into_bytes();
    format!(
        "{:04}-{:04}",
        u16::from_be_bytes([tag[0], tag[1]]) % 10000,
        u16::from_be_bytes([tag[2], tag[3]]) % 10000
    )
}

fn password(code: &str) -> Password {
    Password::new(code.trim().to_uppercase().as_bytes())
}

fn identity_a() -> Identity {
    Identity::new(b"hexgab-A")
}

fn identity_b() -> Identity {
    Identity::new(b"hexgab-B")
}

pub struct SpakeInitiator {
    inner: spake2::Spake2<spake2::Ed25519Group>,
}

impl SpakeInitiator {
    pub fn start(pairing_code: &str) -> (Self, Vec<u8>) {
        let (inner, msg) = Spake2::start_a(
            &password(pairing_code),
            &identity_a(),
            &identity_b(),
        );
        (Self { inner }, msg)
    }

    pub fn finish(self, their_msg: &[u8]) -> Result<(SharedSessionKey, Vec<u8>)> {
        let key = self
            .inner
            .finish(their_msg)
            .map_err(|e| HexGabError::Handshake(e.to_string()))?;
        derive_session(key.as_ref())
    }
}

pub struct SpakeResponder {
    inner: spake2::Spake2<spake2::Ed25519Group>,
}

impl SpakeResponder {
    pub fn start(pairing_code: &str) -> (Self, Vec<u8>) {
        let (inner, msg) = Spake2::start_b(
            &password(pairing_code),
            &identity_a(),
            &identity_b(),
        );
        (Self { inner }, msg)
    }

    pub fn finish(self, their_msg: &[u8]) -> Result<(SharedSessionKey, Vec<u8>)> {
        let key = self
            .inner
            .finish(their_msg)
            .map_err(|e| HexGabError::Handshake(e.to_string()))?;
        derive_session(key.as_ref())
    }
}

fn derive_session(spake_key: &[u8]) -> Result<(SharedSessionKey, Vec<u8>)> {
    let hk = Hkdf::<Sha256>::new(Some(SESSION_INFO), spake_key);
    let mut key = [0u8; 32];
    hk.expand(b"master", &mut key)
        .map_err(|_| HexGabError::Handshake("hkdf failed".into()))?;

    let mut mac = ConfirmMac::new_from_slice(&key).map_err(|_| {
        HexGabError::Handshake("confirm key invalid".into())
    })?;
    Mac::update(&mut mac, CONFIRM_INFO);
    Mac::update(&mut mac, b"initiator->responder");
    let confirm_out = mac.finalize().into_bytes().to_vec();

    Ok((SharedSessionKey { key }, confirm_out))
}

pub fn verify_confirmation(shared: &SharedSessionKey, tag: &[u8], from_initiator: bool) -> Result<()> {
    let mut mac = ConfirmMac::new_from_slice(shared.as_bytes()).map_err(|_| {
        HexGabError::Handshake("confirm key invalid".into())
    })?;
    Mac::update(&mut mac, CONFIRM_INFO);
    if from_initiator {
        Mac::update(&mut mac, b"initiator->responder");
    } else {
        Mac::update(&mut mac, b"responder->initiator");
    }
    let expected = mac.finalize().into_bytes();
    let valid = subtle::ConstantTimeEq::ct_eq(&expected[..16], &tag[..tag.len().min(16)]);
    if valid.into() {
        Ok(())
    } else {
        Err(HexGabError::Handshake("confirmation mismatch".into()))
    }
}

pub fn responder_confirmation(shared: &SharedSessionKey) -> Vec<u8> {
    let mut mac = ConfirmMac::new_from_slice(shared.as_bytes()).expect("hmac");
    Mac::update(&mut mac, CONFIRM_INFO);
    Mac::update(&mut mac, b"responder->initiator");
    mac.finalize().into_bytes().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spake2_full_handshake() {
        let code = "TEST-CODE-12";
        let (a, msg_a) = SpakeInitiator::start(code);
        let (b, msg_b) = SpakeResponder::start(code);
        let (key_a, confirm_a) = a.finish(&msg_b).unwrap();
        let (key_b, _) = b.finish(&msg_a).unwrap();
        let confirm_b = responder_confirmation(&key_b);
        assert_eq!(key_a.as_bytes(), key_b.as_bytes());
        verify_confirmation(&key_b, &confirm_a, true).unwrap();
        verify_confirmation(&key_a, &confirm_b, false).unwrap();
    }
}
