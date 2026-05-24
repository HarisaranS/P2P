//! Session lifecycle: pairing, active chat, secure wipe.

mod bootstrap;
mod controller;
mod metadata;

pub use bootstrap::{
    host_prepare_session, run_host_session, run_join_session, HostListener, SessionHandle,
};
pub use controller::SessionController;
pub use metadata::{apply_receive_padding, pad_message};

use hexgab_core::SessionPhase;
use hexgab_identity::EphemeralIdentity;
pub struct SessionContext {
    pub identity: EphemeralIdentity,
    pub phase: SessionPhase,
}

impl SessionContext {
    pub fn new() -> Self {
        Self {
            identity: EphemeralIdentity::generate(),
            phase: SessionPhase::Init,
        }
    }

    pub fn wipe(&mut self) {
        self.phase = SessionPhase::Wiped;
    }
}

impl Default for SessionContext {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SessionContext {
    fn drop(&mut self) {
        self.phase = SessionPhase::Wiped;
    }
}
