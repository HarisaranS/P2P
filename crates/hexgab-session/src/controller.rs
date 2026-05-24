use hexgab_core::SessionPhase;
use hexgab_crypto::{RatchetDecryptor, RatchetEncryptor, RatchetInit, RatchetState};
use hexgab_handshake::SharedSessionKey;
use crate::metadata::{apply_receive_padding, pad_message};
use hexgab_core::{HexGabError, Result};

pub struct SessionController {
    pub phase: SessionPhase,
    ratchet: Option<RatchetState>,
}

impl SessionController {
    pub fn new() -> Self {
        Self {
            phase: SessionPhase::Init,
            ratchet: None,
        }
    }

    pub fn activate(&mut self, shared: &SharedSessionKey, is_initiator: bool) {
        let init = RatchetInit::from_shared_secret(shared.as_bytes(), is_initiator);
        self.ratchet = Some(RatchetState::new(init));
        self.phase = SessionPhase::Active;
    }

    pub fn encrypt_message(&mut self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let state = self
            .ratchet
            .as_mut()
            .ok_or_else(|| HexGabError::SessionNotReady("ratchet not initialized".into()))?;
        let padded = pad_message(plaintext);
        let aad = b"hexgab-msg";
        RatchetEncryptor::new(state).encrypt(&padded, aad)
    }

    pub fn decrypt_message(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let state = self
            .ratchet
            .as_mut()
            .ok_or_else(|| HexGabError::SessionNotReady("ratchet not initialized".into()))?;
        let padded = RatchetDecryptor::new(state).decrypt(ciphertext, b"hexgab-msg")?;
        apply_receive_padding(&padded).ok_or(HexGabError::Decrypt)
    }

    pub fn terminate(&mut self) {
        self.phase = SessionPhase::Terminating;
        if let Some(mut r) = self.ratchet.take() {
            drop(r);
        }
        self.phase = SessionPhase::Wiped;
    }
}

impl Default for SessionController {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SessionController {
    fn drop(&mut self) {
        self.terminate();
    }
}
