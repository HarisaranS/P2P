# HexGab — Secure Ephemeral P2P Messenger

Production-oriented Rust implementation of an end-to-end encrypted peer-to-peer chat system with **no central server**, **ephemeral identities**, and a **modular security architecture**.

## Architecture

```
Client (CLI / GUI)
    → Session Manager (pairing, lifecycle, wipe)
    → Secure Messaging (Double Ratchet + AEAD)
    → Transport (TCP / Tor SOCKS5)
```

**Design principle:** the transport layer is a dumb encrypted pipe; all trust and confidentiality live in the cryptographic session layer.

## Security stack

| Layer | Technology |
|-------|------------|
| Pairing / MITM resistance | SPAKE2 (password = pairing code) |
| Session keys | HKDF-SHA256 |
| Message encryption | ChaCha20-Poly1305 |
| Forward secrecy | Symmetric hash ratchet (per-message keys) |
| Metadata (optional) | Message padding, random delays |
| Identity | Ephemeral Ed25519 per session |

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for STRIDE/LINDDUN-oriented analysis and known limitations.

## Quick start

### Build locally

```bash
cargo build --release -p hexgab-cli -p hexgab-gui
```

### CLI — two terminals

**Host:**

```bash
cargo run -p hexgab-cli -- host
# Share printed address + pairing code
```

**Join:**

```bash
cargo run -p hexgab-cli -- connect --address 127.0.0.1:PORT --code PAIRINGCODE
```

Verify the **short auth code** on both sides matches (MITM check). Type messages at `> `; use `/end` to wipe the session.

### GUI

```bash
cargo run -p hexgab-gui
```

1. **Start session** → share address + pairing code  
2. **Wait for peer** → confirm auth code  
3. Chat → **End** wipes keys  

### Docker

```bash
docker compose build
docker compose run --rm hexgab-host   # terminal 1
# On another machine/container, connect with CLI using published port
```

**GUI on Linux host:**

```bash
xhost +local:docker
docker compose --profile gui run --rm hexgab-gui
```

**Tor mode:**

```bash
docker compose --profile tor run --rm hexgab-tor
export HEXGAB_TRANSPORT=tor HEXGAB_TOR_SOCKS=127.0.0.1:9050
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HEXGAB_BIND_HOST` | `127.0.0.1` | Listen address |
| `HEXGAB_BIND_PORT` | `0` (random) | Listen port |
| `HEXGAB_TRANSPORT` | `direct` | Set to `tor` for SOCKS5 |
| `HEXGAB_TOR_SOCKS` | `127.0.0.1:9050` | Tor SOCKS proxy |

## Crate layout

```
crates/
  hexgab-core/       Wire types, errors
  hexgab-crypto/     Ratchet, AEAD, replay cache
  hexgab-handshake/  SPAKE2 + confirmation
  hexgab-identity/   Ephemeral session identity
  hexgab-transport/  Framed TCP + SOCKS5
  hexgab-session/    Lifecycle + bootstrap
  hexgab-security/   Memory wipe helpers
  hexgab-client/     Shared client API
  hexgab-cli/        CLI binary
  hexgab-gui/        egui desktop UI
```

## Production checklist

- [ ] Independent cryptographic audit
- [ ] Reproducible builds (`cargo auditable` / `cargo vet`)
- [ ] Formal verification of ratchet state machine
- [ ] Arti-based ephemeral onion services
- [ ] No `unsafe` in crypto path (enforced via CI)

## License

MIT OR Apache-2.0
