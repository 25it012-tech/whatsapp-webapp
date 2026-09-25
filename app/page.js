'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { CallController } from '../lib/calls';
import { isUuid, validateMessage, validateUsername } from '../lib/validation.mjs';

function StreamPlayer({ stream, muted = false, className = '' }) {
  const ref = useRef(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    setBlocked(false);
    if (stream) void element.play().catch(() => setBlocked(true));
    return () => { element.srcObject = null; };
  }, [stream]);
  return <div className={className}>
    <video ref={ref} autoPlay playsInline muted={muted} aria-label={muted ? 'Your camera preview' : 'Remote call media'} />
    {blocked && <button type="button" onClick={() => {
      void ref.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    }}>Tap to enable call audio/video</button>}
  </div>;
}

export default function Home() {
  const [db, setDb] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [lookup, setLookup] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const controller = useRef(null);
  const scrollEnd = useRef(null);
  const userId = session?.user.id;
  const peerId = selected?.id;

  useEffect(() => {
    let alive = true;
    let subscription;
    try {
      const client = getSupabase();
      setDb(client);
      const auth = client.auth.onAuthStateChange((_event, nextSession) => {
        if (alive) { setSession(nextSession); setLoading(false); }
      });
      subscription = auth.data.subscription;
      void client.auth.getSession().then(({ data, error }) => {
        if (!alive) return;
        if (error) setNotice(error.message);
        setSession(data.session);
        setLoading(false);
      });
    } catch (error) { setNotice(error.message); setLoading(false); }
    return () => { alive = false; subscription?.unsubscribe(); };
  }, []);

  useEffect(() => {
    setProfile(null);
    setSelected(null);
    setContacts([]);
    setMessages([]);
    setDraft('');
    if (!db || !userId) return;
    let alive = true;
    void db.from('profiles').select('id, username').eq('id', userId).single().then(({ data, error }) => {
      if (!alive) return;
      if (error) setNotice('Profile unavailable. Run the database setup before registering accounts. ' + error.message);
      else setProfile(data);
    });
    return () => { alive = false; };
  }, [db, userId]);

  useEffect(() => {
    if (!db || !userId || !profile) return;
    let alive = true;
    let busy = false;
    async function refreshContacts() {
      if (busy) return;
      busy = true;
      try {
        const { data, error } = await db.from('messages').select('sender_id, recipient_id, body, created_at')
          .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
          .order('created_at', { ascending: false }).limit(500);
        if (error) throw error;
        const latest = new Map();
        for (const message of data) {
          const id = message.sender_id === userId ? message.recipient_id : message.sender_id;
          if (!latest.has(id)) latest.set(id, message);
        }
        if (!latest.size) return;
        const result = await db.from('profiles').select('id, username').in('id', [...latest.keys()]);
        if (result.error) throw result.error;
        if (alive) {
          const next = result.data.map(person => ({ ...person, last: latest.get(person.id) }))
            .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
          setContacts(previous => [...next, ...previous.filter(person => !latest.has(person.id))]);
        }
      } catch (error) { if (alive) setNotice(error.message); }
      finally { busy = false; }
    }
    void refreshContacts();
    const timer = setInterval(() => void refreshContacts(), 10000);
    const channel = db.channel(`inbox-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${userId}` }, () => void refreshContacts())
      .subscribe();
    return () => { alive = false; clearInterval(timer); void db.removeChannel(channel); };
  }, [db, userId, profile]);

  useEffect(() => {
    setMessages([]);
    setDraft('');
    if (!db || !isUuid(userId) || !isUuid(peerId)) return;
    let alive = true;
    let busy = false;
    setMessagesLoading(true);
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const { data, error } = await db.from('messages').select('*')
          .or(`and(sender_id.eq.${userId},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${userId})`)
          .order('created_at', { ascending: false }).limit(200);
        if (error) throw error;
        if (alive) setMessages(data.reverse());
      } catch (error) { if (alive) setNotice(error.message); }
      finally { busy = false; if (alive) setMessagesLoading(false); }
    }
    void refresh();
    const channel = db.channel(`conversation-${userId}-${peerId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${userId}` }, () => void refresh())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${userId}` }, () => void refresh())
      .subscribe(status => { if (status === 'SUBSCRIBED') void refresh(); });
    const timer = setInterval(() => void refresh(), 5000);
    return () => { alive = false; clearInterval(timer); void db.removeChannel(channel); };
  }, [db, userId, peerId]);

  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, peerId]);

  useEffect(() => {
    if (!db || !userId || !profile) return;
    const calls = new CallController(db, userId, {
      state: setCall, local: setLocalStream, remote: setRemoteStream, error: setNotice
    });
    controller.current = calls;
    void calls.connect();
    return () => { calls.destroy(); if (controller.current === calls) controller.current = null; };
  }, [db, userId, profile]);

  useEffect(() => { setMic(true); setCamera(true); }, [call?.id]);

  async function authenticate(event) {
    event.preventDefault();
    if (!db || authBusy) return;
    setAuthBusy(true);
    setNotice('');
    try {
      const result = mode === 'signup'
        ? await db.auth.signUp({ email: email.trim(), password, options: { data: { username: validateUsername(username) } } })
        : await db.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword('');
      if (mode === 'signup' && !result.data.session) setNotice('Check your email to confirm your account, then sign in.');
    } catch (error) { setNotice(error.message); }
    finally { setAuthBusy(false); }
  }

  async function findContact(event) {
    event.preventDefault();
    if (!profile || lookupBusy) return;
    setLookupBusy(true);
    setNotice('');
    try {
      const value = lookup.trim();
      const field = isUuid(value) ? 'id' : 'username';
      const target = field === 'id' ? value : validateUsername(value);
      const { data, error } = await db.from('profiles').select('id, username').eq(field, target).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('No account found. Ask your friend to register and share their username.');
      if (data.id === userId) throw new Error('Enter a friend’s username, not your own.');
      setContacts(previous => previous.some(person => person.id === data.id) ? previous : [data, ...previous]);
      setSelected(data);
      setLookup('');
    } catch (error) { setNotice(error.message); }
    finally { setLookupBusy(false); }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!selected || !profile || sending) return;
    setSending(true);
    setNotice('');
    try {
      const body = validateMessage(draft);
      const { data, error } = await db.from('messages').insert({ sender_id: userId, recipient_id: selected.id, body }).select().single();
      if (error) throw error;
      setMessages(previous => previous.some(message => message.id === data.id) ? previous : [...previous, data]);
      setContacts(previous => [{ ...selected, last: data }, ...previous.filter(person => person.id !== selected.id)]);
      setDraft('');
    } catch (error) { setNotice(error.message); }
    finally { setSending(false); }
  }

  async function signOut() {
    await controller.current?.end();
    const { error } = await db.auth.signOut();
    if (error) setNotice(error.message);
    else { setNotice(''); setSession(null); }
  }

  const callName = contacts.find(person => person.id === call?.peer)?.username || 'Another member';
  const banner = notice && <div className="notice" role="status">
    <span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button>
  </div>;

  if (loading) return <main className="auth-shell"><p role="status">Opening your conversations…</p></main>;

  if (!session) return <main className="auth-shell">
    <section className="intro">
      <div className="brand"><span className="brand-mark">C</span> Common</div>
      <span className="eyebrow">YOUR PEOPLE. ONE PLACE.</span>
      <h1>A little closer.<br /><em>Wherever you are.</em></h1>
      <p>Make room for the everyday conversations. Message a friend, hear their voice, or meet face to face.</p>
      <div className="intro-card"><span className="avatar">Y</span><div><strong>Built for your conversations</strong><p>Your own independent chat & calling app.</p></div></div>
      <small>Not affiliated with WhatsApp or Meta. Messages are stored in your Supabase project; this MVP does not provide end-to-end encrypted messaging.</small>
    </section>
    <section className="auth-card">
      <span className="eyebrow">LET’S CONNECT</span>
      <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
      <p>{mode === 'login' ? 'Your next conversation starts here.' : 'Choose a username your friends can find.'}</p>
      {banner}
      {!db && <p className="setup-note">Copy .env.example to .env.local, add your Supabase URL and public key, run supabase/schema.sql, and restart. See README.md for setup.</p>}
      <form onSubmit={authenticate}>
        {mode === 'signup' && <label>Username<input value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} autoComplete="username" required placeholder="your_username" /></label>}
        <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="At least 8 characters" /></label>
        <button className="primary full" disabled={!db || authBusy}>{authBusy ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button>
      </form>
      <button className="text-button full" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setNotice(''); }}>
        {mode === 'login' ? 'New here? Create an account' : 'Already a member? Sign in'}
      </button>
    </section>
  </main>;

  return <main className="workspace">
    {banner}
    <div className={`app-shell ${selected ? 'show-chat' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-top"><div className="brand"><span className="brand-mark">C</span> Common</div><button type="button" className="text-button" onClick={() => void signOut()}>Sign out</button></header>
        <div className="identity"><span className="avatar">{(profile?.username || '?')[0].toUpperCase()}</span><div><strong>@{profile?.username || 'Loading profile…'}</strong><small>Share your username to connect</small></div></div>
        <div className="section-heading"><h1>Messages</h1><span className="count">{contacts.length}</span></div>
        <form className="contact-search" onSubmit={findContact}>
          <label className="sr-only" htmlFor="contact-search">Find a friend by username or account ID</label>
          <input id="contact-search" placeholder="Find a friend by username" value={lookup} onChange={event => setLookup(event.target.value)} maxLength={64} required />
          <button type="submit" disabled={!profile || lookupBusy}>{lookupBusy ? '…' : 'Find'}</button>
        </form>
        <nav className="contact-list" aria-label="Conversations">
          {!contacts.length && <div className="empty-list"><strong>Your people go here</strong><p>Ask a friend to create an account, then search for their username above.</p></div>}
          {contacts.map(person => <button type="button" key={person.id} className={`contact ${selected?.id === person.id ? 'active' : ''}`} disabled={sending} onClick={() => setSelected(person)}>
            <span className="avatar">{person.username[0].toUpperCase()}</span>
            <span className="contact-copy"><strong>{person.username}</strong><span>{person.last?.body || 'Say hello 👋'}</span></span>
            {person.last && <time>{new Date(person.last.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
          </button>)}
        </nav>
        <footer className="sidebar-footer">A place for your everyday conversations.</footer>
      </aside>
      <section className="conversation" aria-label="Chat">
        {!selected ? <div className="welcome"><div className="welcome-symbol">C</div><span className="eyebrow">STAY CLOSE, FROM ANYWHERE</span><h2>Good conversations<br />start with hello.</h2><p>Find someone you know and make their day.<br />Messages, voice, and video — in one place.</p><small>Calls work while both people have the app open.</small></div> : <>
          <header className="chat-header">
            <button type="button" className="back-button" disabled={sending} aria-label="Back to conversations" onClick={() => setSelected(null)}>←</button>
            <span className="avatar">{selected.username[0].toUpperCase()}</span>
            <div className="chat-person"><strong>{selected.username}</strong><small>Direct conversation</small></div>
            <div className="call-actions"><button type="button" disabled={!!call || !profile} onClick={() => void controller.current?.start(selected.id, false)}>Voice call</button><button type="button" disabled={!!call || !profile} onClick={() => void controller.current?.start(selected.id, true)}>Video call</button></div>
          </header>
          <div className="message-list" role="log" aria-label="Message history" aria-live="polite">
            <div className="privacy-note">Messages are stored in your project. End-to-end message encryption is not included.</div>
            {messagesLoading && <p className="center-note">Loading messages…</p>}
            {!messagesLoading && !messages.length && <p className="center-note">This is the beginning of your conversation. Say hello!</p>}
            {messages.length >= 200 && <p className="center-note">Showing the latest 200 messages.</p>}
            {messages.map(message => <article key={message.id} className={`bubble ${message.sender_id === userId ? 'outgoing' : 'incoming'}`}>
              <p>{message.body}</p><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </article>)}
            <div ref={scrollEnd} />
          </div>
          <form className="composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="message-draft">Message</label>
            <textarea id="message-draft" rows={1} maxLength={4000} placeholder="Write a message…" value={draft} disabled={sending} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending && draft.trim()) event.currentTarget.form.requestSubmit(); }
            }} />
            <button type="submit" className="primary" disabled={sending || !draft.trim() || !profile}>{sending ? 'Sending…' : 'Send →'}</button>
          </form>
        </>}
      </section>
    </div>
    {call && <section className="call-overlay" role="region" aria-label="Active call">
      <div className="call-panel">
        <span className="eyebrow">{call.video ? 'VIDEO CALL' : 'VOICE CALL'}</span>
        <h2>{callName}</h2><p role="status">{call.status}</p>
        {!process.env.NEXT_PUBLIC_TURN_CREDENTIALS_ENDPOINT && <small className="turn-warning">TURN is not configured. Calls may fail across different networks.</small>}
        <div className={`media-grid ${call.video ? '' : 'audio-only'}`}>
          <StreamPlayer stream={remoteStream} className="remote-media" />
          <StreamPlayer stream={localStream} muted className="local-media" />
        </div>
        <div className="call-controls">
          {call.incoming && call.status === 'Incoming call' && <button type="button" className="primary" onClick={() => void controller.current?.accept()}>Accept call</button>}
          {localStream && <button type="button" aria-pressed={!mic} onClick={() => setMic(controller.current.toggle('audio'))}>{mic ? 'Mute mic' : 'Unmute mic'}</button>}
          {localStream && call.video && <button type="button" aria-pressed={!camera} onClick={() => setCamera(controller.current.toggle('video'))}>{camera ? 'Camera off' : 'Camera on'}</button>}
          <button type="button" className="danger" onClick={() => void controller.current?.end()}>{call.status === 'Incoming call' ? 'Decline' : 'End call'}</button>
        </div>
        <small>Microphone and camera are used only after you start or accept a call.</small>
      </div>
    </section>}
  </main>;
}
