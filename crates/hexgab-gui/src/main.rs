//! HexGab desktop GUI (egui).

use eframe::egui;
use hexgab_session::{host_prepare_session, run_join_session, HostListener, SessionHandle};
use hexgab_transport::direct::TransportConfig;
use std::sync::Arc;
use tokio::runtime::Runtime;
use tokio::sync::{mpsc, Mutex as AsyncMutex};

fn transport_config_from_env() -> TransportConfig {
    let mut config = TransportConfig::default();
    if let Ok(host) = std::env::var("HEXGAB_BIND_HOST") {
        config.bind_host = host;
    }
    if let Ok(port) = std::env::var("HEXGAB_BIND_PORT") {
        if let Ok(p) = port.parse() {
            config.bind_port = p;
        }
    }
    if std::env::var("HEXGAB_TRANSPORT")
        .map(|v| v.eq_ignore_ascii_case("tor"))
        .unwrap_or(false)
    {
        config.use_tor_socks = true;
    }
    if let Ok(proxy) = std::env::var("HEXGAB_TOR_SOCKS") {
        config.tor_socks_proxy = proxy;
    }
    config
}

#[derive(Clone)]
enum UiEvent {
    SessionActive { auth_code: String },
    Message(String),
    Error(String),
    Ended,
}

#[derive(Default, Clone, PartialEq)]
enum AppMode {
    #[default]
    Home,
    Hosting,
    Active,
}

#[derive(Clone)]
enum ChatMessage {
    System(String),
    Sent(String),
    Received(String),
}

struct HexGabApp {
    runtime: Runtime,
    mode: AppMode,
    join_address: String,
    join_code: String,
    host_addr: String,
    host_code: String,
    auth_code: String,
    message_input: String,
    log: Vec<ChatMessage>,
    session: Arc<AsyncMutex<Option<SessionHandle>>>,
    host_listener: Arc<AsyncMutex<Option<HostListener>>>,
    ui_rx: Option<mpsc::UnboundedReceiver<UiEvent>>,
    auth_verified: bool,
}

impl HexGabApp {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        use egui::{FontId, TextStyle};
        let mut style = (*cc.egui_ctx.style()).clone();
        
        // Premium Dark Slate & Indigo Palette
        style.visuals.dark_mode = true;
        style.visuals.panel_fill = egui::Color32::from_rgb(15, 23, 42); // slate-900
        style.visuals.window_fill = egui::Color32::from_rgb(30, 41, 59); // slate-800
        
        style.visuals.widgets.noninteractive.bg_fill = egui::Color32::from_rgb(15, 23, 42);
        style.visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(30, 41, 59);
        style.visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(51, 65, 85); // slate-700
        style.visuals.widgets.active.bg_fill = egui::Color32::from_rgb(71, 85, 105); // slate-600
        
        style.visuals.widgets.inactive.rounding = egui::Rounding::same(8.0);
        style.visuals.widgets.hovered.rounding = egui::Rounding::same(8.0);
        style.visuals.widgets.active.rounding = egui::Rounding::same(8.0);
        style.visuals.window_rounding = egui::Rounding::same(12.0);

        style.text_styles = [
            (TextStyle::Heading, FontId::new(22.0, egui::FontFamily::Proportional)),
            (TextStyle::Body, FontId::new(14.0, egui::FontFamily::Proportional)),
            (TextStyle::Monospace, FontId::new(13.0, egui::FontFamily::Monospace)),
            (TextStyle::Button, FontId::new(14.0, egui::FontFamily::Proportional)),
            (TextStyle::Small, FontId::new(11.0, egui::FontFamily::Proportional)),
        ].into();

        cc.egui_ctx.set_style(style);

        Self {
            runtime: Runtime::new().expect("tokio runtime"),
            mode: AppMode::Home,
            join_address: "127.0.0.1:17845".into(),
            join_code: String::new(),
            host_addr: String::new(),
            host_code: String::new(),
            auth_code: String::new(),
            message_input: String::new(),
            log: vec![ChatMessage::System("HexGab — Enterprise Ephemeral Messenger Initialized".into())],
            session: Arc::new(AsyncMutex::new(None)),
            host_listener: Arc::new(AsyncMutex::new(None)),
            ui_rx: None,
            auth_verified: false,
        }
    }

    fn push_system(&mut self, text: impl Into<String>) {
        self.log.push(ChatMessage::System(text.into()));
    }

    fn push_sent(&mut self, text: impl Into<String>) {
        self.log.push(ChatMessage::Sent(text.into()));
    }

    fn push_received(&mut self, text: impl Into<String>) {
        self.log.push(ChatMessage::Received(text.into()));
    }

    fn poll_ui_events(&mut self) {
        let mut batch = Vec::new();
        if let Some(rx) = &mut self.ui_rx {
            while let Ok(ev) = rx.try_recv() {
                batch.push(ev);
            }
        }
        for ev in batch {
            match ev {
                UiEvent::SessionActive { auth_code } => {
                    self.auth_code = auth_code;
                }
                UiEvent::Message(m) => self.push_received(m),
                UiEvent::Error(e) => self.push_system(format!("Error: {e}")),
                UiEvent::Ended => {
                    self.push_system("Session ended");
                    self.mode = AppMode::Home;
                    self.auth_verified = false;
                }
            }
        }
    }

    fn start_host(&mut self) {
        let config = transport_config_from_env();
        match self.runtime.block_on(host_prepare_session(config)) {
            Ok((bundle, host)) => {
                self.host_addr = bundle.listen_address;
                self.host_code = bundle.pairing_code;
                self.mode = AppMode::Hosting;
                self.auth_verified = false;
                self.runtime.block_on(async {
                    *self.host_listener.lock().await = Some(host);
                });
                self.push_system("Hosting prepared out-of-band");
                self.push_system(format!("Address: {}", self.host_addr));
                self.push_system(format!("Pairing code: {}", self.host_code));
            }
            Err(e) => {
                self.push_system(format!("Host start failed: {e}"));
            }
        }
    }

    fn wait_for_peer(&mut self) {
        let host = self.runtime.block_on(async {
            self.host_listener.lock().await.take()
        });
        let Some(host) = host else {
            self.push_system("No host listener found");
            return;
        };
        let code = self.host_code.clone();
        let session = self.session.clone();
        let (tx, rx) = mpsc::unbounded_channel();
        self.ui_rx = Some(rx);
        self.runtime.spawn(async move {
            match host.accept_peer(&code).await {
                Ok((handle, bundle)) => {
                    let auth = bundle.short_auth_code;
                    let _ = tx.send(UiEvent::SessionActive {
                        auth_code: auth.clone(),
                    });
                    *session.lock().await = Some(handle);
                    loop {
                        let msg = {
                            let mut guard = session.lock().await;
                            if let Some(h) = guard.as_mut() {
                                h.recv_text().await
                            } else {
                                break;
                            }
                        };
                        match msg {
                            Ok(m) => {
                                if tx.send(UiEvent::Message(m)).is_err() {
                                    break;
                                }
                            }
                            Err(e) => {
                                let _ = tx.send(UiEvent::Error(e.to_string()));
                                break;
                            }
                        }
                    }
                    *session.lock().await = None;
                    let _ = tx.send(UiEvent::Ended);
                }
                Err(e) => {
                    let _ = tx.send(UiEvent::Error(e.to_string()));
                }
            }
        });
        self.mode = AppMode::Active;
        self.push_system("Waiting for peer handshake...");
    }

    fn connect(&mut self) {
        let addr = self.join_address.clone();
        let code = self.join_code.clone();
        let session = self.session.clone();
        let (tx, rx) = mpsc::unbounded_channel();
        self.ui_rx = Some(rx);
        self.auth_verified = false;
        self.push_system(format!("Connecting to {addr}..."));
        self.runtime.spawn(async move {
            match run_join_session(&addr, &code).await {
                Ok((handle, auth)) => {
                    let _ = tx.send(UiEvent::SessionActive { auth_code: auth });
                    *session.lock().await = Some(handle);
                    loop {
                        let msg = {
                            let mut guard = session.lock().await;
                            if let Some(h) = guard.as_mut() {
                                h.recv_text().await
                            } else {
                                break;
                            }
                        };
                        match msg {
                            Ok(m) => {
                                if tx.send(UiEvent::Message(m)).is_err() {
                                    break;
                                }
                            }
                            Err(e) => {
                                let _ = tx.send(UiEvent::Error(e.to_string()));
                                break;
                            }
                        }
                    }
                    *session.lock().await = None;
                    let _ = tx.send(UiEvent::Ended);
                }
                Err(e) => {
                    let _ = tx.send(UiEvent::Error(e.to_string()));
                }
            }
        });
        self.mode = AppMode::Active;
    }

    fn send_message(&mut self) {
        let text = self.message_input.trim().to_string();
        if text.is_empty() {
            return;
        }
        let session = self.session.clone();
        let ok = self.runtime.block_on(async {
            let mut guard = session.lock().await;
            if let Some(h) = guard.as_mut() {
                h.send_text(&text).await.is_ok()
            } else {
                false
            }
        });
        if ok {
            self.push_sent(&text);
            self.message_input.clear();
        } else {
            self.push_system("Send failed — no active session");
        }
    }

    fn end_session(&mut self) {
        let session = self.session.clone();
        self.runtime.block_on(async {
            if let Some(h) = session.lock().await.as_mut() {
                let _ = h.end_session().await;
            }
            *session.lock().await = None;
        });
        self.mode = AppMode::Home;
        self.auth_verified = false;
        self.push_system("Session terminated");
    }
}

impl eframe::App for HexGabApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_ui_events();

        egui::TopBottomPanel::top("header_panel").show(ctx, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(8.0);
                ui.heading("HexGab");
                ui.label("Enterprise-grade Zero-Trust Ephemeral P2P Messenger");
                ui.add_space(8.0);
            });
        });

        egui::CentralPanel::default().show(ctx, |ui| {
            match self.mode {
                AppMode::Home => {
                    ui.columns(2, |columns| {
                        // Left Column: Host Session Card
                        columns[0].vertical(|ui| {
                            let frame = egui::Frame::default()
                                .fill(egui::Color32::from_rgb(30, 41, 59))
                                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(51, 65, 85)))
                                .rounding(12.0)
                                .inner_margin(16.0);
                            
                            frame.show(ui, |ui| {
                                ui.set_min_height(250.0);
                                ui.vertical_centered(|ui| {
                                    ui.heading("Host P2P Session");
                                    ui.add_space(12.0);
                                    ui.label("Host a new secure session. The app will bind to a port and generate a high-entropy SPAKE2 pairing code for connection establishment.");
                                    ui.add_space(24.0);
                                    let btn = egui::Button::new("Start Hosting")
                                        .fill(egui::Color32::from_rgb(79, 70, 229))
                                        .min_size(egui::vec2(160.0, 36.0));
                                    if ui.add(btn).clicked() {
                                        self.start_host();
                                    }
                                });
                            });
                        });

                        // Right Column: Join Session Card
                        columns[1].vertical(|ui| {
                            let frame = egui::Frame::default()
                                .fill(egui::Color32::from_rgb(30, 41, 59))
                                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(51, 65, 85)))
                                .rounding(12.0)
                                .inner_margin(16.0);

                            frame.show(ui, |ui| {
                                ui.set_min_height(250.0);
                                ui.vertical_centered(|ui| {
                                    ui.heading("Join Peer Session");
                                    ui.add_space(12.0);
                                    ui.horizontal(|ui| {
                                        ui.label("Host IP:Port");
                                        ui.text_edit_singleline(&mut self.join_address);
                                    });
                                    ui.add_space(8.0);
                                    ui.horizontal(|ui| {
                                        ui.label("Pairing Code");
                                        ui.text_edit_singleline(&mut self.join_code);
                                    });
                                    ui.add_space(16.0);
                                    let btn = egui::Button::new("Connect to Peer")
                                        .fill(egui::Color32::from_rgb(20, 184, 166))
                                        .min_size(egui::vec2(160.0, 36.0));
                                    if ui.add(btn).clicked() {
                                        self.connect();
                                    }
                                });
                            });
                        });
                    });
                }
                AppMode::Hosting => {
                    let frame = egui::Frame::default()
                        .fill(egui::Color32::from_rgb(30, 41, 59))
                        .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(51, 65, 85)))
                        .rounding(12.0)
                        .inner_margin(20.0);

                    frame.show(ui, |ui| {
                        ui.vertical_centered(|ui| {
                            ui.heading("Session Host Active");
                            ui.add_space(8.0);
                            ui.label("Waiting for peer. Share the information below out-of-band to establish a secure channel.");
                            ui.add_space(16.0);
                        });

                        ui.group(|ui| {
                            ui.horizontal(|ui| {
                                ui.strong("Listen Address: ");
                                ui.monospace(&self.host_addr);
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    if ui.button("📋 Copy").clicked() {
                                        ui.ctx().output_mut(|o| o.copied_text = self.host_addr.clone());
                                    }
                                });
                            });
                        });
                        ui.add_space(8.0);
                        ui.group(|ui| {
                            ui.horizontal(|ui| {
                                ui.strong("Pairing Code:   ");
                                ui.monospace(&self.host_code);
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    if ui.button("📋 Copy").clicked() {
                                        ui.ctx().output_mut(|o| o.copied_text = self.host_code.clone());
                                    }
                                });
                            });
                        });

                        ui.add_space(20.0);
                        ui.vertical_centered(|ui| {
                            let btn = egui::Button::new("Wait for Peer")
                                .fill(egui::Color32::from_rgb(79, 70, 229))
                                .min_size(egui::vec2(180.0, 36.0));
                            if ui.add(btn).clicked() {
                                self.wait_for_peer();
                            }
                            ui.add_space(8.0);
                            if ui.button("Cancel").clicked() {
                                self.mode = AppMode::Home;
                            }
                        });
                    });
                }
                AppMode::Active => {
                    // Render SAS (Short Authentication String) Verification card
                    if !self.auth_code.is_empty() {
                        let auth_frame = egui::Frame::default()
                            .fill(if self.auth_verified {
                                egui::Color32::from_rgb(6, 78, 59) // Dark green
                            } else {
                                egui::Color32::from_rgb(120, 53, 4) // Dark orange
                            })
                            .rounding(8.0)
                            .inner_margin(12.0);

                        auth_frame.show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.strong("Verification SAS Code: ");
                                ui.colored_label(egui::Color32::WHITE, format!("{}", self.auth_code));
                                ui.add_space(20.0);
                                ui.checkbox(&mut self.auth_verified, "I verified this code out-of-band");
                            });
                            if !self.auth_verified {
                                ui.small("⚠️ WARNING: Confirm this 8-digit code matches on your peer's screen to guarantee MITM protection.");
                            }
                        });
                        ui.add_space(8.0);
                    }

                    // Render Chat logs inside a scroll area
                    let chat_height = ui.available_height() - 60.0;
                    egui::ScrollArea::vertical()
                        .max_height(chat_height)
                        .stick_to_bottom(true)
                        .show(ui, |ui| {
                            ui.vertical(|ui| {
                                for line in &self.log {
                                    match line {
                                        ChatMessage::System(text) => {
                                            ui.vertical_centered(|ui| {
                                                ui.colored_label(egui::Color32::from_rgb(148, 163, 184), format!("[System] {text}"));
                                            });
                                            ui.add_space(6.0);
                                        }
                                        ChatMessage::Sent(text) => {
                                            ui.horizontal(|ui| {
                                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                                    let bubble_frame = egui::Frame::default()
                                                        .fill(egui::Color32::from_rgb(79, 70, 229))
                                                        .rounding(egui::Rounding {
                                                            nw: 12.0,
                                                            ne: 12.0,
                                                            sw: 12.0,
                                                            se: 0.0,
                                                        })
                                                        .inner_margin(8.0);
                                                    bubble_frame.show(ui, |ui| {
                                                        ui.colored_label(egui::Color32::WHITE, text);
                                                    });
                                                });
                                            });
                                            ui.add_space(6.0);
                                        }
                                        ChatMessage::Received(text) => {
                                            ui.horizontal(|ui| {
                                                let bubble_frame = egui::Frame::default()
                                                    .fill(egui::Color32::from_rgb(51, 65, 85))
                                                    .rounding(egui::Rounding {
                                                        nw: 12.0,
                                                        ne: 12.0,
                                                        sw: 0.0,
                                                        se: 12.0,
                                                    })
                                                    .inner_margin(8.0);
                                                bubble_frame.show(ui, |ui| {
                                                    ui.colored_label(egui::Color32::from_rgb(241, 245, 249), text);
                                                });
                                            });
                                            ui.add_space(6.0);
                                        }
                                    }
                                }
                            });
                        });

                    ui.separator();

                    // Message Composer
                    ui.horizontal(|ui| {
                        let response = ui.add(
                            egui::TextEdit::singleline(&mut self.message_input)
                                .hint_text("Type a secure message...")
                                .desired_width(ui.available_width() - 180.0)
                        );
                        if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                            self.send_message();
                            response.request_focus();
                        }
                        
                        let send_btn = egui::Button::new("Send")
                            .fill(egui::Color32::from_rgb(79, 70, 229));
                        if ui.add(send_btn).clicked() {
                            self.send_message();
                        }
                        
                        let end_btn = egui::Button::new("End Session")
                            .fill(egui::Color32::from_rgb(220, 38, 38));
                        if ui.add(end_btn).clicked() {
                            self.end_session();
                        }
                    });
                }
            }
        });

        ctx.request_repaint_after(std::time::Duration::from_millis(100));
    }
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([760.0, 680.0])
            .with_title("HexGab Secure Messenger"),
        ..Default::default()
    };
    eframe::run_native(
        "HexGab",
        native_options,
        Box::new(|cc| Box::new(HexGabApp::new(cc))),
    )
    .expect("gui");
}
