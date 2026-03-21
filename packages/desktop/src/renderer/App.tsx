import React, { useEffect, useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { useStore } from './stores/store';

// We import the fonts statically assuming they were added or they will be resolved by vite
import '@fontsource/jetbrains-mono';
import '@fontsource/syne/700.css';

const GlobalStyle = createGlobalStyle`
  :root {
    --bg-void:        #0A0A0A;
    --bg-surface:     #111111;
    --bg-elevated:    #1A1A1A;
    --bg-hover:       #222222;
    --border-subtle:  #1E1E1E;
    --border-active:  #2E2E2E;
    --text-primary:   #E8E8E8;
    --text-secondary: #7A7A7A;
    --text-muted:     #444444;
    --accent:         #00E5C8;
    --accent-dim:     #007A6B;
    --warning:        #F5A623;
    --danger:         #C0392B;
    --verified:       #00E5C8;
    --unverified:     #F5A623;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 0;
    background-color: var(--bg-void);
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    overflow: hidden;
    user-select: none;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: 'Syne', sans-serif;
    margin: 0;
  }
`;

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
`;

const TopBar = styled.div`
  height: 38px;
  background: var(--bg-void);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  -webkit-app-region: drag;
`;

const Title = styled.div`
  font-family: 'Syne', sans-serif;
  color: var(--accent);
  font-weight: 700;
  font-size: 14px;
  margin-right: 24px;
  letter-spacing: 2px;
`;

const StatusIndicator = styled.div<{ active?: boolean, warning?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: ${props => props.active ? 'var(--accent)' : props.warning ? 'var(--warning)' : 'var(--text-secondary)'};

  &::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: ${props => props.active ? 'var(--accent)' : props.warning ? 'var(--warning)' : 'var(--text-muted)'};
    box-shadow: ${props => props.active ? '0 0 6px var(--accent)' : 'none'};
  }
`;

const MainContent = styled.div`
  display: flex;
  flex: 1;
  background: var(--bg-surface);
`;

const Sidebar = styled.div`
  width: 280px;
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  background: var(--bg-void);
`;

const SidebarHeader = styled.div`
  padding: 16px;
  border-bottom: 1px solid var(--border-subtle);
`;

const SearchInput = styled.input`
  width: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  padding: 8px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  border-radius: 4px;
  outline: none;
  
  &:focus {
    border-color: var(--accent-dim);
  }
`;

const ContactList = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const ContactItem = styled.div<{ active?: boolean }>`
  padding: 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  background: ${props => props.active ? 'var(--bg-elevated)' : 'transparent'};
  border-left: 2px solid ${props => props.active ? 'var(--accent)' : 'transparent'};
  
  &:hover {
    background: var(--bg-hover);
  }
`;

const ContactName = styled.div`
  font-size: 13px;
  font-weight: bold;
  color: var(--text-primary);
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
`;

const UnreadBadge = styled.span`
  background: var(--accent);
  color: var(--bg-void);
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: bold;
`;

const ContactPreview = styled.div`
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ChatArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`;

const ChatHeader = styled.div`
  height: 60px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  padding: 0 24px;
`;

const ChatHeaderTitle = styled.div`
  font-size: 15px;
  font-weight: bold;
  color: var(--text-primary);
`;

const ContactStatus = styled.div<{ verified?: boolean }>`
  font-size: 11px;
  color: ${props => props.verified ? 'var(--verified)' : 'var(--unverified)'};
  margin-left: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const MessagesContainer = styled.div`
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const MessageBubbleBox = styled.div<{ isMine?: boolean }>`
  align-self: ${props => props.isMine ? 'flex-end' : 'flex-start'};
  max-width: 70%;
  display: flex;
  flex-direction: column;
`;

const MessageText = styled.div<{ isMine?: boolean }>`
  background: ${props => props.isMine ? 'var(--accent-dim)' : 'var(--bg-elevated)'};
  color: ${props => props.isMine ? '#fff' : 'var(--text-primary)'};
  padding: 12px 16px;
  border-radius: ${props => props.isMine ? '8px 8px 0 8px' : '8px 8px 8px 0'};
  font-size: 13px;
  line-height: 1.5;
  border: 1px solid ${props => props.isMine ? 'transparent' : 'var(--border-subtle)'};
`;

const MessageMeta = styled.div<{ isMine?: boolean }>`
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 6px;
  align-self: ${props => props.isMine ? 'flex-end' : 'flex-start'};
  display: flex;
  gap: 6px;
`;

const InputArea = styled.div`
  padding: 16px 24px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-subtle);
`;

const MessageInput = styled.input`
  width: 100%;
  background: var(--bg-void);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  padding: 14px 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  border-radius: 4px;
  outline: none;
  transition: all 0.2s;

  &:focus {
    border-color: var(--accent-dim);
    box-shadow: 0 0 0 1px var(--accent-dim);
  }
`;

const PeerInfoPanel = styled.div`
  width: 280px;
  background: var(--bg-void);
  border-left: 1px solid var(--border-subtle);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const PanelSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionLabel = styled.div`
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 1px;
`;

const DetailText = styled.div`
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
  background: var(--bg-elevated);
  padding: 8px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
`;

const ActionsContainer = styled.div`
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ActionButton = styled.button<{ danger?: boolean }>`
  background: ${props => props.danger ? 'var(--danger)' : 'var(--bg-elevated)'};
  color: ${props => props.danger ? '#FFF' : 'var(--text-primary)'};
  border: 1px solid ${props => props.danger ? 'var(--danger)' : 'var(--border-subtle)'};
  padding: 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: bold;
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    background: ${props => props.danger ? '#A93226' : 'var(--bg-hover)'};
  }
`;

const PanicButton = styled.button`
  background: var(--danger);
  color: white;
  border: none;
  padding: 8px 16px;
  font-family: 'Syne', sans-serif;
  font-weight: 700;
  cursor: pointer;
  text-transform: uppercase;
  margin-left: 16px;
`;

const App: React.FC = () => {
  const { contacts, torStatus, connectedPeers, activeConversationId, setActiveConversation, panicWipe, myPeerId, myMultiaddr, generateIdentity, addContact, exportChat, messages, addMessage, verifyContact } = useStore();
  const [draftedMessage, setDraftedMessage] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPeerId, setNewChatPeerId] = useState('');
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const activeContact = contacts.find(c => c.id === activeConversationId);

  useEffect(() => {
    const fetchStatus = async () => {
      if ((window as any).phantom?.getTorStatus) {
        const initialStatus = await (window as any).phantom.getTorStatus();
        useStore.getState().setTorStatus(initialStatus.status);
      }
    };
    fetchStatus();

    // Listen to IPC events for tor connection updates
    if ((window as any).phantom?.onTorStatus) {
      (window as any).phantom.onTorStatus((status: any) => {
        useStore.getState().setTorStatus(status.status);
      });
    } // <-- MISSING CLOSING BRACE
    // Listen to incoming P2P string messages
    if ((window as any).phantom?.p2p?.onMessage) {
      (window as any).phantom.p2p.onMessage((msg: any) => {
        useStore.getState().addContact(msg.senderId);
        useStore.getState().addMessage({
          id: Math.random().toString(36).substring(7),
          conversationId: msg.senderId,
          senderId: msg.senderId,
          text: msg.text,
          timestamp: msg.timestamp || Date.now(),
          deliveryStatus: 'delivered'
        });
      });
    }
    
    // Listen to live peer count updates
    if ((window as any).phantom?.p2p?.onPeers) {
      (window as any).phantom.p2p.onPeers((count: number) => {
        useStore.getState().setConnectedPeers(count);
      });
    }
  }, []);

  if (!(window as any).phantom) {
    return (
      <>
        <GlobalStyle />
        <Layout style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px' }}>
          <Title style={{ fontSize: '32px', marginBottom: '16px', color: 'var(--danger)' }}>RUNTIME ERROR</Title>
          <div style={{ color: 'var(--text-secondary)', maxWidth: '600px', lineHeight: '1.8' }}>
            Phantom cannot access its native security engine.<br />
            Please interact with the dedicated Electron Desktop application window.<br /><br />
            <small style={{ opacity: 0.5 }}>(window.phantom is not available in this context)</small>
          </div>
        </Layout>
      </>
    );
  }

  const handleNewChat = () => {
    const trimmed = newChatPeerId.trim();
    if (trimmed) {
      addContact(trimmed);
      setNewChatPeerId('');
      setShowNewChatModal(false);
    }
  };

  return (
    <>
      <GlobalStyle />

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-active)',
            borderRadius: '8px', padding: '32px', width: '480px'
          }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent)', marginBottom: '8px', letterSpacing: '2px' }}>NEW SECURE CHANNEL</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  <div style={{ marginBottom: '4px' }}>Enter the full address of who you want to chat with.</div>
                  <div style={{ color: 'var(--accent)' }}>Paste a full multiaddr for direct connection between two local instances.</div>
                </div>
              <input
              ref={inputRef}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-void)', border: '1px solid var(--border-active)',
                color: 'var(--text-primary)', padding: '12px', fontFamily: 'JetBrains Mono',
                fontSize: '11px', borderRadius: '4px', outline: 'none', marginBottom: '16px'
              }}
              placeholder="/ip4/IP/tcp/PORT/p2p/12D3KooW... or just PeerID"
              value={newChatPeerId}
              onChange={e => setNewChatPeerId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleNewChat(); if (e.key === 'Escape') setShowNewChatModal(false); }}
            />
            {myMultiaddr ? (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Your connection address (share this):<br />
                <span 
                  style={{ color: 'var(--accent)', cursor: 'pointer', wordBreak: 'break-all', fontFamily: 'JetBrains Mono', fontSize: '9px' }}
                  onClick={() => navigator.clipboard.writeText(myMultiaddr)}
                  title="Click to copy"
                >
                  {myMultiaddr}
                </span><br />
                <span style={{ opacity: 0.5 }}>(click to copy)</span>
              </div>
            ) : myPeerId ? (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Your ID: <span style={{ color: 'var(--accent)', cursor: 'pointer', wordBreak: 'break-all', fontFamily: 'JetBrains Mono', fontSize: '9px' }}
                  onClick={() => navigator.clipboard.writeText(myPeerId)}>{myPeerId}</span> (click to copy)
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '8px' }}>
              <ActionButton style={{ flex: 1 }} onClick={() => setShowNewChatModal(false)}>Cancel</ActionButton>
              <ActionButton style={{ flex: 2, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={handleNewChat}>Connect</ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Wipe Confirm Modal */}
      {showWipeConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--danger)',
            borderRadius: '8px', padding: '32px', width: '420px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--danger)', marginBottom: '8px' }}>EMERGENCY WIPE</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
              This will instantly destroy all cryptographic keys, contacts, and message buffers from memory.
              This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <ActionButton style={{ flex: 1 }} onClick={() => setShowWipeConfirm(false)}>Cancel</ActionButton>
              <ActionButton danger style={{ flex: 1 }} onClick={() => { panicWipe(); setShowWipeConfirm(false); }}>WIPE NOW</ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Delete Chat Confirm Modal */}
      {deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-active)',
            borderRadius: '8px', padding: '28px', width: '380px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px' }}>Delete Conversation?</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '20px' }}>This will permanently erase this conversation from RAM.</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <ActionButton style={{ flex: 1 }} onClick={() => setDeleteTarget(null)}>Cancel</ActionButton>
              <ActionButton danger style={{ flex: 1 }} onClick={() => {
                useStore.setState(s => ({ contacts: s.contacts.filter(c => c.id !== deleteTarget), activeConversationId: null }));
                setDeleteTarget(null);
              }}>Delete</ActionButton>
            </div>
          </div>
        </div>
      )}

      <Layout>
        <TopBar>
          <Title>PHANTOM</Title>
          <span style={{ opacity: 0.5 }}>No servers. No logs. No traces.</span>
          <StatusIndicator active={torStatus === 'CONNECTED'} warning={torStatus === 'CONNECTING'}>
            Tor: {torStatus}
          </StatusIndicator>
          {torStatus === 'ERROR' && (
            <span style={{ marginLeft: '12px', color: 'var(--danger)', fontSize: '10px', fontWeight: 'bold' }}>
              ⚠ DIRECT ROUTING
            </span>
          )}
          <span style={{ marginLeft: '16px', color: 'var(--text-muted)' }}>|</span>
          <span style={{ marginLeft: '16px' }}>Peers: {connectedPeers}</span>
          <PanicButton onClick={() => setShowWipeConfirm(true)} title="Instantly clear all memory buffers and identities">WIPE APP</PanicButton>
        </TopBar>
        
        <MainContent>
          <Sidebar>
            <SidebarHeader>
              <div style={{ paddingBottom: '16px' }}>
                <ActionButton 
                  style={{ width: '100%', borderColor: 'var(--accent)' }}
                  onClick={() => { setShowNewChatModal(true); }}
                >+ START NEW CHAT</ActionButton>
              </div>
              {!myPeerId ? (
                <ActionButton style={{ marginTop: '12px', width: '100%' }} onClick={() => generateIdentity()}>
                  Generate Identity
                </ActionButton>
              ) : (
                <div style={{ marginTop: '12px' }}>
                  {myMultiaddr
                    ? <div style={{ fontSize: '9px', color: 'var(--accent)', fontFamily: 'JetBrains Mono', wordBreak: 'break-all', cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(myMultiaddr!)} title="Click to copy connection address">ADDR: {myMultiaddr}</div>
                    : <div style={{ fontSize: '10px', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'JetBrains Mono' }} onClick={() => navigator.clipboard.writeText(myPeerId || '')} title="Click to copy your ID">My ID: {myPeerId?.slice(0, 16)}... (copy)</div>
                  }
                  <ActionButton 
                    style={{ marginTop: '8px', fontSize: '9px', padding: '6px', opacity: 0.7 }}
                    onClick={() => useStore.getState().resetIdentity()}
                  >Generate New Identity</ActionButton>
                </div>
              )}
            </SidebarHeader>
            <ContactList>
              {contacts.map(contact => (
                <ContactItem 
                  key={contact.id} 
                  active={activeConversationId === contact.id}
                  onClick={() => setActiveConversation(contact.id)}
                >
                  <ContactName>
                    {contact.displayName || `Peer ${contact.id.substring(0, 8)}`}
                    {contact.unreadCount > 0 && <UnreadBadge>{contact.unreadCount}</UnreadBadge>}
                  </ContactName>
                  <ContactPreview>{contact.lastMessage}</ContactPreview>
                </ContactItem>
              ))}
              {contacts.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
                  No active chats. Memory is empty.
                </div>
              )}
            </ContactList>
          </Sidebar>

          <ChatArea>
            {activeContact ? (
              <>
                <ChatHeader>
                  <ChatHeaderTitle>{activeContact.displayName || `Peer ${activeContact.id.substring(0, 8)}`}</ChatHeaderTitle>
                  <ContactStatus verified={activeContact.isVerified}>
                    {activeContact.isVerified ? '✓ Verified' : '⚠ Unverified'}
                  </ContactStatus>
                </ChatHeader>
                
                <MessagesContainer>
                  {(messages[activeContact.id] || []).map(msg => (
                    <MessageBubbleBox key={msg.id} isMine={msg.senderId === myPeerId}>
                      <MessageText isMine={msg.senderId === myPeerId}>{msg.text}</MessageText>
                      <MessageMeta isMine={msg.senderId === myPeerId}>Now • {msg.deliveryStatus}</MessageMeta>
                    </MessageBubbleBox>
                  ))}
                </MessagesContainer>

                <InputArea>
                  <MessageInput 
                    placeholder="Type a message..." 
                    value={draftedMessage}
                    onChange={(e) => setDraftedMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draftedMessage.trim() !== '') {
                        const msgText = draftedMessage.trim();
                        setDraftedMessage('');
                        
                        // Send over P2P: pass full multiaddr if known, else peer ID
                        if ((window as any).phantom?.p2p) {
                          const contactId = activeContact.id;
                          const timestamp = Date.now();
                          
                          // Add to local UI store immediately
                          addMessage({
                            id: Math.random().toString(36).substring(7),
                            conversationId: contactId,
                            senderId: myPeerId!,
                            text: msgText,
                            timestamp: timestamp,
                            deliveryStatus: 'delivered'
                          });

                          (window as any).phantom.p2p.sendMessage({
                            to: activeContact.dialAddress || contactId,  // prioritize multiaddr for dialing
                            text: msgText
                          }).catch((err: any) => {
                            console.error('Failed to send p2p msg:', err);
                            // Optionally mark as failed in UI if needed
                          });
                        }
                      }
                    }}
                  />
                </InputArea>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Select a conversation or start a new chat
              </div>
            )}
          </ChatArea>

          {activeContact && (
            <PeerInfoPanel>
              <PanelSection>
                <SectionLabel>Peer ID</SectionLabel>
                <DetailText>{activeContact.id}</DetailText>
              </PanelSection>
              
              <PanelSection>
                <SectionLabel>Safety Number</SectionLabel>
                <DetailText style={{ fontFamily: 'JetBrains Mono', letterSpacing: '2px', color: activeContact.isVerified ? 'var(--verified)' : 'var(--warning)' }}>
                  {activeContact.safetyNumber || 'NOT GENERATED'}
                </DetailText>
                {!activeContact.isVerified && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Compare this with your contact directly.
                  </div>
                )}
              </PanelSection>

              <ActionsContainer>
                {!activeContact.isVerified && (
                  <ActionButton onClick={() => verifyContact(activeContact.id)} style={{ color: 'var(--verified)', borderColor: 'var(--verified)' }}>
                    Verify Identity
                  </ActionButton>
                )}
                <ActionButton onClick={() => exportChat(activeContact.id)}>Export Buffer</ActionButton>
                <ActionButton danger onClick={() => setDeleteTarget(activeContact.id)}>Delete Chat</ActionButton>
              </ActionsContainer>
            </PeerInfoPanel>
          )}

        </MainContent>
      </Layout>
    </>
  );
};

export default App;
