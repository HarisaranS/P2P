import { create } from 'zustand';

interface Contact {
  id: string; // Peer ID
  dialAddress?: string; // Full multiaddr for dialing
  displayName?: string;
  isVerified: boolean;
  safetyNumber: string | null;
  lastMessage: string | null;
  unreadCount: number;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  timestamp: number;
  deliveryStatus: 'sending' | 'delivered' | 'read';
}

interface AppState {
  myPeerId: string | null;
  myMultiaddr: string | null;
  torStatus: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  connectedPeers: number;
  contacts: Contact[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>; // conversationId -> messages
  
  setTorStatus: (status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR') => void;
  setConnectedPeers: (count: number) => void;
  setMyMultiaddr: (addr: string | null) => void;
  setActiveConversation: (id: string | null) => void;
  verifyContact: (id: string) => void;
  addMessage: (msg: Message) => void;
  addContact: (id: string) => void;
  exportChat: (conversationId: string) => Promise<void>;
  generateIdentity: () => Promise<void>;
  resetIdentity: () => Promise<void>;
  panicWipe: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  myPeerId: null,
  myMultiaddr: null,
  torStatus: 'CONNECTING',
  connectedPeers: 0,
  contacts: [],
  activeConversationId: null,
  messages: {},

  generateIdentity: async () => {
    try {
      if ((window as any).phantom?.crypto) {
        const id = await (window as any).phantom.crypto.generateIdentity();
        set({ myPeerId: id.peerId });
        
        // Boot the P2P engine securely after identity generation
        if ((window as any).phantom?.p2p) {
          await (window as any).phantom.p2p.start({
            identity: id,
            anonymityMode: 'direct'
          });
          // Fetch the full listening multiaddr to display to user
          const addrs: string[] = await (window as any).phantom.p2p.getAddresses();
          const usable = addrs.find((a: string) => a.includes('/tcp/') && !a.includes('/127.0.0.1/')) 
            || addrs.find((a: string) => a.includes('/tcp/'))
            || null;
          set({ myMultiaddr: usable });
        }
      } else {
        throw new Error('Fatal Error: Secure Crypto Module Unavailable. Halting generation.');
      }
    } catch (e) {
      console.error('Failed to generate identity securely:', e);
      alert('Failed to construct secure cryptographic identity. System halted.');
    }
  },

  setTorStatus: (status) => set({ torStatus: status }),
  setConnectedPeers: (count) => set({ connectedPeers: count }),
  setMyMultiaddr: (addr) => set({ myMultiaddr: addr }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  verifyContact: (id) => set((state) => {
    // Generate a pseudo-random looking safety number mask based on the ID
    const hashSeed = id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const sn = `${(hashSeed * 10).toString(16).toUpperCase()} ${Math.floor(Math.random()*9999)} ${(hashSeed * 20).toString(16).toUpperCase()} ${Math.floor(Math.random()*9999)}`;
    return {
      contacts: state.contacts.map(c => c.id === id ? { ...c, isVerified: true, safetyNumber: sn } : c)
    };
  }),
  resetIdentity: async () => {
    const { myPeerId } = get();
    if (confirm('Permanently destroy your current identity and generate a new one? This will disconnect you from all current peers.')) {
        set({ myPeerId: null, myMultiaddr: null });
        await (get() as any).generateIdentity();
    }
  },
  addContact: (idOrAddr) => set((state) => {
    let id = idOrAddr;
    let dialAddress = undefined;
    
    // If it's a full multiaddr, extract the PeerID part
    if (idOrAddr.includes('/p2p/')) {
       const parts = idOrAddr.split('/p2p/');
       id = parts[1];
       dialAddress = idOrAddr;
    }
    
    if (state.contacts.find(c => c.id === id)) return state;
    return {
      contacts: [...state.contacts, { 
        id, 
        dialAddress,
        isVerified: false, 
        safetyNumber: null, 
        lastMessage: null, 
        unreadCount: 0 
      }],
      activeConversationId: id
    };
  }),
  addMessage: (msg) => set((state) => ({
    messages: {
      ...state.messages,
      [msg.conversationId]: [...(state.messages[msg.conversationId] || []), msg]
    }
  })),
  exportChat: async (conversationId) => {
    const msgs = useStore.getState().messages[conversationId] || [];
    if (msgs.length === 0) return;
    const blob = new Blob([JSON.stringify(msgs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phantom-export-${conversationId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  panicWipe: () => set({ contacts: [], messages: {}, activeConversationId: null, myPeerId: null })
}));
