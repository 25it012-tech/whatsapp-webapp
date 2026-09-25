// Non-trickle ICE: complete SDP is exchanged through RLS-protected rows.
// No camera/microphone access occurs until Start or Accept is pressed.
export class CallController {
  constructor(db, userId, callbacks) {
    this.db = db;
    this.userId = userId;
    this.callbacks = callbacks;
    this.current = null;
    this.disposed = false;
    this.polling = false;
    this.seen = new Set();
    this.since = new Date(Date.now() - 45000).toISOString();
  }

  async connect() {
    this.timer = setInterval(() => void this.poll(), 2000);
    await this.poll();
  }

  async poll() {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      const { data, error } = await this.db.from('call_signals').select('*')
        .eq('recipient_id', this.userId).gte('created_at', this.since)
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      for (const signal of data || []) {
        if (this.disposed) break;
        if (this.seen.has(signal.id)) continue;
        this.seen.add(signal.id);
        await this.receive(signal);
      }
      if (data?.length) this.since = data[data.length - 1].created_at;
      // Duplicate suppression remains bounded; timestamps already advance.
      if (this.seen.size > 2000) this.seen = new Set((data || []).map(s => s.id));
    } catch (error) {
      if (!this.disposed) this.callbacks.error(error.message);
    } finally { this.polling = false; }
  }

  async signal(call, kind, payload = {}) {
    const { error } = await this.db.from('call_signals').insert({
      call_id: call.id, sender_id: this.userId, recipient_id: call.peer, kind, payload
    });
    if (error) throw error;
  }

  publish(status) {
    if (this.current && !this.disposed) {
      const { id, peer, video, incoming } = this.current;
      this.callbacks.state({ id, peer, video, incoming, status });
    }
  }

  expiry(call) {
    clearTimeout(call.timeout);
    call.timeout = setTimeout(() => {
      if (this.current === call) {
        this.callbacks.error('Call timed out. Both people must keep the app open.');
        void this.end();
      }
    }, 60000);
  }

  async receive(signal) {
    if (signal.kind === 'offer') {
      if (Date.now() - Date.parse(signal.created_at) > 60000) return;
      if (this.current) {
        if (this.current.id !== signal.call_id) {
          await this.signal({ id: signal.call_id, peer: signal.sender_id }, 'end');
        }
        return;
      }
      if (signal.payload?.sdp?.type !== 'offer' || typeof signal.payload.sdp.sdp !== 'string') return;
      const call = { id: signal.call_id, peer: signal.sender_id,
        video: signal.payload.video === true, incoming: true, offer: signal.payload.sdp };
      this.current = call;
      this.publish('Incoming call');
      this.expiry(call);
      return;
    }
    const call = this.current;
    if (!call || call.id !== signal.call_id || call.peer !== signal.sender_id) return;
    if (signal.kind === 'end') { this.cleanup(); return; }
    if (signal.kind === 'answer' && !call.incoming && call.pc?.signalingState === 'have-local-offer') {
      if (signal.payload?.sdp?.type !== 'answer' || typeof signal.payload.sdp.sdp !== 'string') return;
      try {
        await call.pc.setRemoteDescription(signal.payload.sdp);
        if (this.current === call) this.publish('Connecting');
      } catch (error) { this.callbacks.error(error.message); await this.end(); }
    }
  }

  async prepare(call) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('Calling requires a supported browser on HTTPS or localhost.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.video });
    if (this.current !== call || this.disposed) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Call cancelled.');
    }
    call.stream = stream;
    this.callbacks.local(stream);
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    // Optional endpoint should return short-lived credentials after authenticating
    // the Supabase bearer token. Never expose a provider's master TURN secret.
    const endpoint = process.env.NEXT_PUBLIC_TURN_CREDENTIALS_ENDPOINT;
    if (endpoint) {
      const { data, error } = await this.db.auth.getSession();
      if (error || !data.session) throw new Error('Sign in again before calling.');
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('Unable to obtain TURN credentials.');
      const configuration = await response.json();
      if (!Array.isArray(configuration.iceServers) || !configuration.iceServers.length) {
        throw new Error('TURN endpoint must return a nonempty iceServers array.');
      }
      iceServers.push(...configuration.iceServers);
    }
    if (this.current !== call || this.disposed) throw new Error('Call cancelled.');
    const pc = new RTCPeerConnection({ iceServers });
    call.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const remote = new MediaStream();
    pc.ontrack = event => {
      if (this.current !== call) return;
      if (!remote.getTracks().some(track => track.id === event.track.id)) remote.addTrack(event.track);
      this.callbacks.remote(remote);
    };
    pc.onconnectionstatechange = () => {
      if (this.current !== call) return;
      if (pc.connectionState === 'connected') {
        clearTimeout(call.timeout);
        clearTimeout(call.disconnectTimeout);
        this.publish('Connected');
      } else if (pc.connectionState === 'failed') {
        this.callbacks.error('Connection failed. Check network access and configure TURN.');
        void this.end();
      } else if (pc.connectionState === 'disconnected') {
        this.publish('Reconnecting');
        clearTimeout(call.disconnectTimeout);
        call.disconnectTimeout = setTimeout(() => {
          if (this.current === call && pc.connectionState !== 'connected') void this.end();
        }, 15000);
      }
    };
    return pc;
  }

  async completeSdp(pc, description) {
    await pc.setLocalDescription(description);
    if (pc.iceGatheringState !== 'complete') {
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', check); };
        const check = () => { if (pc.iceGatheringState === 'complete') { done(); resolve(); } };
        const timeout = setTimeout(() => { done(); reject(new Error('ICE gathering timed out. Check TURN configuration.')); }, 15000);
        pc.addEventListener('icegatheringstatechange', check);
        check();
      });
    }
    return pc.localDescription.toJSON();
  }

  async start(peer, video) {
    if (this.current || this.disposed) return;
    const call = { id: crypto.randomUUID(), peer, video, incoming: false };
    this.current = call;
    this.publish('Preparing call');
    this.expiry(call);
    try {
      const pc = await this.prepare(call);
      const sdp = await this.completeSdp(pc, await pc.createOffer());
      if (this.current !== call) return;
      await this.signal(call, 'offer', { sdp, video });
      if (this.current === call) this.publish('Ringing');
    } catch (error) {
      if (this.current === call) { this.callbacks.error(error.message); await this.end(); }
    }
  }

  async accept() {
    const call = this.current;
    if (!call?.incoming || call.accepting) return;
    call.accepting = true;
    this.publish('Connecting');
    this.expiry(call);
    try {
      const pc = await this.prepare(call);
      await pc.setRemoteDescription(call.offer);
      const sdp = await this.completeSdp(pc, await pc.createAnswer());
      if (this.current === call) await this.signal(call, 'answer', { sdp });
    } catch (error) {
      if (this.current === call) { this.callbacks.error(error.message); await this.end(); }
    }
  }

  toggle(kind) {
    const tracks = this.current?.stream?.getTracks().filter(track => track.kind === kind) || [];
    if (!tracks.length) return false;
    const enabled = !tracks[0].enabled;
    tracks.forEach(track => { track.enabled = enabled; });
    return enabled;
  }

  cleanup() {
    const call = this.current;
    this.current = null;
    if (call) {
      clearTimeout(call.timeout);
      clearTimeout(call.disconnectTimeout);
      if (call.pc) { call.pc.ontrack = null; call.pc.onconnectionstatechange = null; call.pc.close(); }
      call.stream?.getTracks().forEach(track => track.stop());
    }
    this.callbacks.local(null);
    this.callbacks.remote(null);
    this.callbacks.state(null);
  }

  async end() {
    const call = this.current;
    this.cleanup();
    if (call) {
      try { await this.signal(call, 'end'); }
      catch (error) { if (!this.disposed) this.callbacks.error(error.message); }
    }
  }

  destroy() {
    this.disposed = true;
    clearInterval(this.timer);
    const call = this.current;
    this.cleanup();
    if (call) void this.signal(call, 'end').catch(() => {});
  }
}
