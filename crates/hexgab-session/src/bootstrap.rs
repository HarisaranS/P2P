//! Session establishment over the transport layer.

use hexgab_core::{FrameKind, HexGabError, PairingBundle, Result, WireFrame};
use hexgab_handshake::{
    generate_pairing_code, responder_confirmation, short_auth_code, verify_confirmation,
    SpakeInitiator, SpakeResponder,
};
use hexgab_identity::EphemeralIdentity;
use hexgab_transport::{direct::TransportConfig, Listener, TransportStream};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

use crate::controller::SessionController;
use crate::metadata::random_delay_ms;
use hexgab_core::SessionPhase;

#[derive(Serialize, Deserialize)]
enum HandshakePayload {
    SpakeA(Vec<u8>),
    SpakeB(Vec<u8>),
    Confirm(Vec<u8>),
    ConfirmAck,
}

/// Bind listener and return pairing details immediately; call [`host_accept_peer`] when ready.
pub async fn host_prepare_session(config: TransportConfig) -> Result<(PairingBundle, HostListener)> {
    let identity = EphemeralIdentity::generate();
    let pairing_code = generate_pairing_code();
    let listener = Listener::bind(&config).await?;
    let listen_address = listener.address.to_string();
    let session_id = identity.session_id();

    let bundle = PairingBundle {
        session_id,
        listen_address,
        pairing_code,
        short_auth_code: String::new(),
    };

    Ok((bundle, HostListener { listener, session_id }))
}

pub struct HostListener {
    listener: Listener,
    session_id: Uuid,
}

impl HostListener {
    pub async fn accept_peer(self, pairing_code: &str) -> Result<(SessionHandle, PairingBundle)> {
        let listen_address = self.listener.address.to_string();
        let stream = self.listener.accept().await?;
        let mut transport = TransportStream::new(stream);
        let (controller, mut bundle) = complete_handshake_host(
            &mut transport,
            self.session_id,
            pairing_code,
            true,
        )
        .await?;
        bundle.listen_address = listen_address;
        bundle.pairing_code = pairing_code.to_string();
        Ok((
            SessionHandle {
                transport,
                controller,
                is_initiator: true,
                session_id: self.session_id,
            },
            bundle,
        ))
    }
}

pub async fn run_host_session(config: TransportConfig) -> Result<(PairingBundle, SessionHandle)> {
    let (bundle, host) = host_prepare_session(config).await?;
    let code = bundle.pairing_code.clone();
    let (handle, final_bundle) = host.accept_peer(&code).await?;
    Ok((final_bundle, handle))
}

pub async fn run_join_session(address: &str, pairing_code: &str) -> Result<(SessionHandle, String)> {
    let stream = hexgab_transport::connect_tcp(address).await?;
    let mut transport = stream;
    let session_id = Uuid::new_v4();

    let (controller, bundle) =
        complete_handshake_join(&mut transport, session_id, pairing_code, false).await?;

    Ok((
        SessionHandle {
            transport,
            controller,
            is_initiator: false,
            session_id: bundle.session_id,
        },
        bundle.short_auth_code,
    ))
}

pub struct SessionHandle {
    pub transport: TransportStream,
    pub controller: SessionController,
    pub is_initiator: bool,
    pub session_id: Uuid,
}

impl SessionHandle {
    pub async fn send_text(&mut self, text: &str) -> Result<()> {
        let ct = self.controller.encrypt_message(text.as_bytes())?;
        let frame = WireFrame::new(FrameKind::Encrypted, self.session_id, ct);
        self.transport.send(&frame).await?;
        sleep(Duration::from_millis(random_delay_ms())).await;
        Ok(())
    }

    pub async fn recv_text(&mut self) -> Result<String> {
        println!("[RECV_TEXT] Entered loop, self.session_id={}", self.session_id);
        loop {
            let frame = self.transport.recv().await?;
            println!("[RECV_TEXT] Received frame kind={:?}, frame.session_id={}, expected={}", frame.kind(), frame.session_id, self.session_id);
            if frame.session_id != self.session_id {
                println!("[RECV_TEXT] session ID mismatch! expected={}, got={}", self.session_id, frame.session_id);
                continue;
            }
            match frame.kind()? {
                FrameKind::Encrypted => {
                    let pt = self.controller.decrypt_message(&frame.payload)?;
                    return String::from_utf8(pt)
                        .map_err(|_| HexGabError::Crypto("invalid utf8".into()));
                }
                FrameKind::Control if frame.payload == b"END" => {
                    return Err(HexGabError::SessionNotReady("peer ended session".into()));
                }
                _ => continue,
            }
        }
    }

    pub async fn end_session(&mut self) -> Result<()> {
        let frame = WireFrame::new(FrameKind::Control, self.session_id, b"END".to_vec());
        self.transport.send(&frame).await?;
        self.controller.terminate();
        Ok(())
    }
}

async fn complete_handshake_host(
    transport: &mut TransportStream,
    session_id: Uuid,
    pairing_code: &str,
    is_initiator: bool,
) -> Result<(SessionController, PairingBundle)> {
    println!("[HOST] Starting handshake with session_id={}", session_id);
    let (spake_a, msg_a) = SpakeInitiator::start(pairing_code);
    send_hs(transport, session_id, HandshakePayload::SpakeA(msg_a)).await?;
    println!("[HOST] Sent SpakeA");

    let frame = transport.recv().await?;
    println!("[HOST] Received frame for SpakeB: session_id={}, expected={}", frame.session_id, session_id);
    if frame.session_id != session_id {
        return Err(HexGabError::Handshake("session ID mismatch".into()));
    }
    let msg_b = match parse_hs(&frame)? {
        HandshakePayload::SpakeB(m) => m,
        _ => return Err(HexGabError::Handshake("expected spake B".into())),
    };
    println!("[HOST] Parsed SpakeB");

    let (shared, confirm_a) = spake_a.finish(&msg_b)?;
    let auth = short_auth_code(shared.as_bytes());

    send_hs(
        transport,
        session_id,
        HandshakePayload::Confirm(confirm_a),
    )
    .await?;
    println!("[HOST] Sent ConfirmA");

    let frame = transport.recv().await?;
    println!("[HOST] Received frame for ConfirmB: session_id={}, expected={}", frame.session_id, session_id);
    if frame.session_id != session_id {
        return Err(HexGabError::Handshake("session ID mismatch".into()));
    }
    match parse_hs(&frame)? {
        HandshakePayload::Confirm(tag) => {
            verify_confirmation(&shared, &tag, false)?;
        }
        _ => return Err(HexGabError::Handshake("expected confirm".into())),
    }
    println!("[HOST] Verified ConfirmB");

    send_hs(transport, session_id, HandshakePayload::ConfirmAck).await?;
    println!("[HOST] Sent ConfirmAck");

    let mut controller = SessionController::new();
    controller.phase = SessionPhase::Pairing;
    controller.activate(&shared, is_initiator);

    let bundle = PairingBundle {
        session_id,
        listen_address: String::new(),
        pairing_code: pairing_code.to_string(),
        short_auth_code: auth,
    };

    Ok((controller, bundle))
}

async fn complete_handshake_join(
    transport: &mut TransportStream,
    _client_session_id: Uuid,
    pairing_code: &str,
    is_initiator: bool,
) -> Result<(SessionController, PairingBundle)> {
    println!("[JOINER] Starting handshake, waiting for SpakeA");
    let frame = transport.recv().await?;
    let session_id = frame.session_id; // Adopt the host's session ID
    println!("[JOINER] Received frame for SpakeA: session_id={}", session_id);
    let msg_a = match parse_hs(&frame)? {
        HandshakePayload::SpakeA(m) => m,
        _ => return Err(HexGabError::Handshake("expected spake A".into())),
    };

    let (spake_b, msg_b) = SpakeResponder::start(pairing_code);
    send_hs(transport, session_id, HandshakePayload::SpakeB(msg_b)).await?;
    println!("[JOINER] Sent SpakeB");

    let frame = transport.recv().await?;
    println!("[JOINER] Received frame for ConfirmA: session_id={}, expected={}", frame.session_id, session_id);
    if frame.session_id != session_id {
        return Err(HexGabError::Handshake("session ID mismatch".into()));
    }
    let confirm_a = match parse_hs(&frame)? {
        HandshakePayload::Confirm(m) => m,
        _ => return Err(HexGabError::Handshake("expected confirm".into())),
    };
    println!("[JOINER] Parsed ConfirmA");

    let (shared, _) = spake_b.finish(&msg_a)?;
    let auth = short_auth_code(shared.as_bytes());

    verify_confirmation(&shared, &confirm_a, true)?;
    let confirm_b = responder_confirmation(&shared);
    send_hs(
        transport,
        session_id,
        HandshakePayload::Confirm(confirm_b),
    )
    .await?;
    println!("[JOINER] Sent ConfirmB");

    let frame = transport.recv().await?;
    println!("[JOINER] Received frame for ConfirmAck: session_id={}, expected={}", frame.session_id, session_id);
    if frame.session_id != session_id {
        return Err(HexGabError::Handshake("session ID mismatch".into()));
    }
    match parse_hs(&frame)? {
        HandshakePayload::ConfirmAck => {}
        _ => return Err(HexGabError::Handshake("expected confirm ack".into())),
    }
    println!("[JOINER] Parsed ConfirmAck");

    let mut controller = SessionController::new();
    controller.activate(&shared, is_initiator);

    Ok((
        controller,
        PairingBundle {
            session_id,
            listen_address: String::new(),
            pairing_code: pairing_code.to_string(),
            short_auth_code: auth,
        },
    ))
}

async fn send_hs(
    transport: &mut TransportStream,
    session_id: Uuid,
    payload: HandshakePayload,
) -> Result<()> {
    let bytes = bincode::serialize(&payload).map_err(|e| HexGabError::Handshake(e.to_string()))?;
    let frame = WireFrame::new(FrameKind::Handshake, session_id, bytes);
    transport.send(&frame).await
}

fn parse_hs(frame: &WireFrame) -> Result<HandshakePayload> {
    if frame.kind()? != FrameKind::Handshake {
        return Err(HexGabError::Handshake("not handshake frame".into()));
    }
    bincode::deserialize(&frame.payload).map_err(|e| HexGabError::Handshake(e.to_string()))
}
