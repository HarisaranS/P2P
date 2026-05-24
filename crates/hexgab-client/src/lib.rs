//! High-level client API for CLI and GUI frontends.

use hexgab_core::{HexGabError, PairingBundle, Result};
use hexgab_session::{host_prepare_session, run_join_session, HostListener, SessionHandle};
use hexgab_transport::direct::TransportConfig;
use std::env;
use tokio::sync::mpsc;

pub fn transport_config_from_env() -> TransportConfig {
    let mut config = TransportConfig::default();
    if let Ok(host) = env::var("HEXGAB_BIND_HOST") {
        config.bind_host = host;
    }
    if let Ok(port) = env::var("HEXGAB_BIND_PORT") {
        if let Ok(p) = port.parse() {
            config.bind_port = p;
        }
    }
    if env::var("HEXGAB_TRANSPORT")
        .map(|v| v.eq_ignore_ascii_case("tor"))
        .unwrap_or(false)
    {
        config.use_tor_socks = true;
    }
    if let Ok(proxy) = env::var("HEXGAB_TOR_SOCKS") {
        config.tor_socks_proxy = proxy;
    }
    config
}

pub enum ClientEvent {
    PairingReady(PairingBundle),
    SessionActive {
        auth_code: String,
    },
    MessageReceived(String),
    Error(String),
    SessionEnded,
}

pub struct HexGabClient;

impl HexGabClient {
    pub async fn start_host(tx: mpsc::UnboundedSender<ClientEvent>) -> Result<HostListener> {
        let config = transport_config_from_env();
        let (bundle, host) = host_prepare_session(config).await?;
        let _ = tx.send(ClientEvent::PairingReady(bundle));
        Ok(host)
    }

    pub async fn accept_host(
        host: HostListener,
        pairing_code: String,
        tx: mpsc::UnboundedSender<ClientEvent>,
    ) -> Result<()> {
        let (mut handle, bundle) = host.accept_peer(&pairing_code).await?;
        let _ = tx.send(ClientEvent::SessionActive {
            auth_code: bundle.short_auth_code,
        });
        Self::run_chat_loop(handle, tx).await
    }

    pub async fn join(
        address: String,
        pairing_code: String,
        tx: mpsc::UnboundedSender<ClientEvent>,
    ) -> Result<()> {
        let (mut handle, auth) = run_join_session(&address, &pairing_code).await?;
        let _ = tx.send(ClientEvent::SessionActive { auth_code: auth });
        Self::run_chat_loop(handle, tx).await
    }

    async fn run_chat_loop(
        mut handle: SessionHandle,
        tx: mpsc::UnboundedSender<ClientEvent>,
    ) -> Result<()> {
        loop {
            match handle.recv_text().await {
                Ok(msg) => {
                    let _ = tx.send(ClientEvent::MessageReceived(msg));
                }
                Err(e) => {
                    let _ = tx.send(ClientEvent::Error(e.to_string()));
                    let _ = tx.send(ClientEvent::SessionEnded);
                    return Err(e);
                }
            }
        }
    }

    pub async fn send_message(handle: &mut SessionHandle, text: &str) -> Result<()> {
        handle.send_text(text).await
    }

    pub async fn end_session(handle: &mut SessionHandle) -> Result<()> {
        handle.end_session().await?;
        Ok(())
    }
}
