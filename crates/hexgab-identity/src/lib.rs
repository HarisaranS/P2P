//! Ephemeral per-session identity (no persistent user accounts).

use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use uuid::Uuid;
use zeroize::Zeroize;

pub struct EphemeralIdentity {
    pub session_id: Uuid,
    signing_key: SigningKey,
}

impl EphemeralIdentity {
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        Self {
            session_id: Uuid::new_v4(),
            signing_key,
        }
    }

    pub fn session_id(&self) -> Uuid {
        self.session_id
    }
}

impl Drop for EphemeralIdentity {
    fn drop(&mut self) {
        unsafe {
            let ptr = &mut self.signing_key as *mut ed25519_dalek::SigningKey as *mut u8;
            let len = std::mem::size_of::<ed25519_dalek::SigningKey>();
            for i in 0..len {
                std::ptr::write_volatile(ptr.add(i), 0);
            }
        }
        self.session_id = uuid::Uuid::nil();
    }
}
