//! Transport abstraction: length-prefixed frames over TCP (optional Tor SOCKS5).

mod codec;
pub mod direct;

pub use codec::{read_frame, write_frame};
pub use direct::{Dialer, Listener, TransportConfig};

use hexgab_core::{HexGabError, Result, WireFrame};
use tokio::net::TcpStream;

pub struct TransportStream {
    inner: TcpStream,
}

impl TransportStream {
    pub fn new(stream: TcpStream) -> Self {
        Self { inner: stream }
    }

    pub async fn send(&mut self, frame: &WireFrame) -> Result<()> {
        write_frame(&mut self.inner, frame).await
    }

    pub async fn recv(&mut self) -> Result<WireFrame> {
        read_frame(&mut self.inner).await
    }
}

pub async fn connect_tcp(addr: &str) -> Result<TransportStream> {
    let stream = TcpStream::connect(addr)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    stream
        .set_nodelay(true)
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    Ok(TransportStream::new(stream))
}

pub async fn connect_via_socks5(
    proxy: &str,
    target_host: &str,
    target_port: u16,
) -> Result<TransportStream> {
    use std::net::SocketAddr;
    let proxy_addr: SocketAddr = proxy
        .parse()
        .map_err(|_| HexGabError::Transport("invalid SOCKS proxy address".into()))?;

    let stream = TcpStream::connect(proxy_addr)
        .await
        .map_err(|e| HexGabError::Transport(format!("SOCKS connect: {e}")))?;

    socks5_handshake(stream, target_host, target_port).await
}

async fn socks5_handshake(
    mut stream: TcpStream,
    host: &str,
    port: u16,
) -> Result<TransportStream> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    stream
        .write_all(&[0x05, 0x01, 0x00])
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    let mut resp = [0u8; 2];
    stream
        .read_exact(&mut resp)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    if resp != [0x05, 0x00] {
        return Err(HexGabError::Transport("SOCKS auth failed".into()));
    }

    let host_bytes = host.as_bytes();
    if host_bytes.len() > 255 {
        return Err(HexGabError::Transport("hostname too long".into()));
    }
    let mut req = Vec::with_capacity(7 + host_bytes.len());
    req.push(0x05);
    req.push(0x01);
    req.push(0x00);
    req.push(0x03);
    req.push(host_bytes.len() as u8);
    req.extend_from_slice(host_bytes);
    req.extend_from_slice(&port.to_be_bytes());

    stream
        .write_all(&req)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;

    let mut head = [0u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    if head[0] != 0x05 || head[1] != 0x00 {
        return Err(HexGabError::Transport("SOCKS request failed".into()));
    }

    match head[3] {
        0x01 => {
            let mut rest = [0u8; 6];
            stream.read_exact(&mut rest).await.map_err(|e| {
                HexGabError::Transport(e.to_string())
            })?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await.map_err(|e| {
                HexGabError::Transport(e.to_string())
            })?;
            let mut domain = vec![0u8; len[0] as usize + 2];
            stream.read_exact(&mut domain).await.map_err(|e| {
                HexGabError::Transport(e.to_string())
            })?;
        }
        0x04 => {
            let mut rest = [0u8; 18];
            stream.read_exact(&mut rest).await.map_err(|e| {
                HexGabError::Transport(e.to_string())
            })?;
        }
        _ => return Err(HexGabError::Transport("SOCKS bad reply".into())),
    }

    Ok(TransportStream::new(stream))
}
