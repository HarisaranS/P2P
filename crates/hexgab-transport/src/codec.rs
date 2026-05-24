use hexgab_core::{HexGabError, Result, WireFrame, MAX_FRAME_SIZE, PROTOCOL_VERSION};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, frame: &WireFrame) -> Result<()> {
    let payload = bincode::serialize(frame).map_err(|e| HexGabError::Transport(e.to_string()))?;
    if payload.len() > MAX_FRAME_SIZE {
        return Err(HexGabError::FrameTooLarge);
    }
    let len = u32::try_from(payload.len()).map_err(|_| HexGabError::FrameTooLarge)?;
    w.write_all(&len.to_be_bytes())
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    w.write_all(&payload)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    w.flush()
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    Ok(())
}

pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<WireFrame> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_SIZE {
        return Err(HexGabError::FrameTooLarge);
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)
        .await
        .map_err(|e| HexGabError::Transport(e.to_string()))?;
    let frame: WireFrame =
        bincode::deserialize(&buf).map_err(|e| HexGabError::Transport(e.to_string()))?;
    if frame.version != PROTOCOL_VERSION {
        return Err(HexGabError::VersionMismatch);
    }
    Ok(frame)
}
