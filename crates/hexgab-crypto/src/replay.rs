use std::collections::HashSet;

const MAX_CACHE: usize = 10_000;

/// Sliding window replay protection for message counters.
#[derive(Default)]
pub struct ReplayCache {
    seen: HashSet<u64>,
    order: Vec<u64>,
}

impl ReplayCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn check_and_insert(&mut self, counter: u64) -> bool {
        if self.seen.contains(&counter) {
            return false;
        }
        self.seen.insert(counter);
        self.order.push(counter);
        if self.order.len() > MAX_CACHE {
            if let Some(old) = self.order.first().copied() {
                self.order.remove(0);
                self.seen.remove(&old);
            }
        }
        true
    }
}
