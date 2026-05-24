use hexgab_core::{HexGabError, Result};
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};

#[derive(Debug, Clone)]
pub struct TransportConfig {
    pub bind_host: String,
    pub bind_port: u16,
    pub use_tor_socks: bool,
    pub tor_socks_proxy: String,
}

impl Default for TransportConfig {
    fn default() -> Self {
        Self {
            bind_host: "127.0.0.1".into(),
            bind_port: 0,
            use_tor_socks: false,
            tor_socks_proxy: "127.0.0.1:9050".into(),
        }
    }
}

pub struct Listener {
    inner: TcpListener,
    pub address: SocketAddr,
}

impl Listener {
    pub async fn bind(config: &TransportConfig) -> Result<Self> {
        let addr: SocketAddr = format!("{}:{}", config.bind_host, config.bind_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| HexGabError::Transport(e.to_string()))?;
        let inner = TcpListener::bind(addr)
            .await
            .map_err(|e| HexGabError::Transport(e.to_string()))?;
        let address = inner
            .local_addr()
            .map_err(|e| HexGabError::Transport(e.to_string()))?;
        Ok(Self { inner, address })
    }

    pub async fn accept(&self) -> Result<TcpStream> {
        let (stream, _) = self
            .inner
            .accept()
            .await
            .map_err(|e| HexGabError::Transport(e.to_string()))?;
        Ok(stream)
    }
}

pub struct Dialer {
    pub config: TransportConfig,
}

impl Dialer {
    pub fn new(config: TransportConfig) -> Self {
        Self { config }
    }

    pub async fn connect(&self, target: &str) -> Result<TcpStream> {
        if self.config.use_tor_socks {
            let (host, port) = parse_host_port(target)?;
            crate::connect_via_socks5(&self.config.tor_socks_proxy, &host, port)
                .await
                .map(|t| t.inner)
        } else {
            TcpStream::connect(target)
                .await
                .map_err(|e| HexGabError::Transport(e.to_string()))
        }
    }
}

fn parse_host_port(addr: &str) -> Result<(String, u16)> {
    if let Some((h, p)) = addr.rsplit_once(':') {
        let port: u16 = p
            .parse()
            .map_err(|_| HexGabError::Transport("invalid port".into()))?;
        Ok((h.to_string(), port))
    } else {
        Err(HexGabError::Transport(
            "address must be host:port".into(),
        ))
    }
}
