//! Optional metadata protection: padding and constant-size buckets.

use hexgab_core::MAX_PLAINTEXT_SIZE;
use rand::Rng;

const BUCKET_SIZES: [usize; 4] = [256, 512, 1024, 2048];

pub fn pad_message(plaintext: &[u8]) -> Vec<u8> {
    if plaintext.len() > MAX_PLAINTEXT_SIZE {
        return plaintext.to_vec();
    }
    let target = BUCKET_SIZES
        .iter()
        .copied()
        .find(|&s| plaintext.len() <= s)
        .unwrap_or(MAX_PLAINTEXT_SIZE);
    let mut out = Vec::with_capacity(target + 2);
    out.extend_from_slice(&(plaintext.len() as u16).to_be_bytes());
    out.extend_from_slice(plaintext);
    let pad_len = target.saturating_sub(plaintext.len());
    let mut rng = rand::thread_rng();
    let mut pad = vec![0u8; pad_len];
    rng.fill(&mut pad[..]);
    out.extend_from_slice(&pad);
    out
}

pub fn apply_receive_padding(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 2 {
        return None;
    }
    let len = u16::from_be_bytes([data[0], data[1]]) as usize;
    if len + 2 > data.len() {
        return None;
    }
    Some(data[2..2 + len].to_vec())
}

pub fn random_delay_ms() -> u64 {
    rand::thread_rng().gen_range(10..80)
}
