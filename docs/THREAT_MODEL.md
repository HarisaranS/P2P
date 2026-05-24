# HexGab Threat Model

## Scope

HexGab provides **ephemeral, pairwise, end-to-end encrypted** messaging over an anonymizing or direct transport. There is **no account system** and **no persistent server-side state**.

## Assets

- Pairing secret (human-chosen or displayed code)
- Session master key (SPAKE2 + HKDF)
- Ratchet message keys
- Plaintext message content
- Ephemeral signing keys (session-bound)

## STRIDE summary

| Threat | Mitigation | Residual risk |
|--------|------------|---------------|
| Spoofing | SPAKE2 PAKE; short auth string (SAS) | Weak pairing codes |
| Tampering | AEAD; transcript confirmation | Implementation bugs |
| Repudiation | Not a goal (no long-term identity) | — |
| Information disclosure | E2E encryption; Tor option | Traffic correlation, timing |
| Denial of service | None by design (P2P) | Peer can drop connection |
| Elevation | No privileged server role | Compromised endpoint |

## LINDDUN (privacy)

| Concern | Mitigation | Gap |
|---------|------------|-----|
| Linkability | Ephemeral keys; Tor | Global traffic analysis |
| Identifiability | No accounts | User behavior, metadata |
| Detectability | Padding + delays (basic) | Not strong traffic shaping |
| Disclosure | E2E | Endpoint compromise |
| Unawareness | SAS verification UX | User skips verification |
| Non-compliance | Open components | Operator policies |

## Explicit non-goals / limitations

1. **OS-level forensics** — swap, core dumps, malware on device  
2. **Physical access** — cold boot, memory extraction  
3. **Global passive adversary** — may correlate Tor timing/volume  
4. **Post-quantum** — classical curves only (upgrade path: PQ KEM)  
5. **Asynchronous messaging** — both peers must be online  

## Recommendations for deployers

1. Compare **short auth codes** out-of-band after connect.  
2. Use **high-entropy pairing codes** (default generator: 12 chars).  
3. Enable **Tor** for network-location hiding.  
4. Run **reproducible builds** and verify image digests.  
5. Schedule **third-party crypto audit** before production release.
