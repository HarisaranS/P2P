//! End-to-end encrypted session test.

use hexgab_session::{host_prepare_session, run_join_session};
use hexgab_transport::direct::TransportConfig;
use tokio::sync::oneshot;

#[tokio::test]
async fn e2e_encrypted_chat() {
    let config = TransportConfig {
        bind_host: "127.0.0.1".into(),
        bind_port: 0,
        ..Default::default()
    };

    let (bundle, host) = host_prepare_session(config).await.expect("host bind");
    let addr = bundle.listen_address.clone();
    let code = bundle.pairing_code.clone();

    let (host_tx, host_rx) = oneshot::channel();

    let code_host = code.clone();
    let host_task = tokio::spawn(async move {
        let (mut handle, bundle) = host.accept_peer(&code_host).await.expect("host accept");
        host_tx.send(bundle.short_auth_code).ok();
        handle
            .send_text("hello from host")
            .await
            .expect("host send");
        let reply = handle.recv_text().await.expect("host recv");
        assert_eq!(reply, "hello from client");
        handle.end_session().await.ok();
    });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let (mut client, client_auth) = run_join_session(&addr, &code)
        .await
        .expect("client join");
    let host_auth = host_rx.await.expect("host auth");

    assert_eq!(host_auth, client_auth, "SAS must match");

    let msg = client.recv_text().await.expect("client recv");
    assert_eq!(msg, "hello from host");

    client
        .send_text("hello from client")
        .await
        .expect("client send");

    host_task.await.expect("host task");
}
