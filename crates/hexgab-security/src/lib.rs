//! Secure memory wiping utilities.

use zeroize::Zeroize;

pub fn wipe_vec(v: &mut Vec<u8>) {
    v.zeroize();
    v.clear();
}

pub fn wipe_slice(s: &mut [u8]) {
    s.zeroize();
}
