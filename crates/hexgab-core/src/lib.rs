//! Shared types and errors for HexGab.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_FRAME_SIZE: usize = 64 * 1024;
pub const MAX_PLAINTEXT_SIZE: usize = 32 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum FrameKind {
    Handshake = 0x01,
    Encrypted = 0x02,
    Control = 0x03,
}

impl TryFrom<u8> for FrameKind {
    type Error = HexGabError;

    fn try_from(v: u8) -> std::result::Result<Self, Self::Error> {
        match v {
            0x01 => Ok(Self::Handshake),
            0x02 => Ok(Self::Encrypted),
            0x03 => Ok(Self::Control),
            _ => Err(HexGabError::InvalidFrame),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireFrame {
    pub version: u8,
    pub kind: u8,
    pub session_id: Uuid,
    pub payload: Vec<u8>,
}

impl WireFrame {
    pub fn new(kind: FrameKind, session_id: Uuid, payload: Vec<u8>) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            kind: kind as u8,
            session_id,
            payload,
        }
    }

    pub fn kind(&self) -> Result<FrameKind> {
        FrameKind::try_from(self.kind)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SessionPhase {
    Init = 0,
    Pairing = 1,
    Active = 2,
    Terminating = 3,
    Wiped = 4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingBundle {
    pub session_id: Uuid,
    pub listen_address: String,
    pub pairing_code: String,
    pub short_auth_code: String,
}

#[derive(Debug, thiserror::Error)]
pub enum HexGabError {
    #[error("invalid wire frame")]
    InvalidFrame,
    #[error("frame too large")]
    FrameTooLarge,
    #[error("protocol version mismatch")]
    VersionMismatch,
    #[error("session not ready: {0}")]
    SessionNotReady(String),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("handshake failed: {0}")]
    Handshake(String),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("replay detected")]
    Replay,
    #[error("decryption failed")]
    Decrypt,
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, HexGabError>;
