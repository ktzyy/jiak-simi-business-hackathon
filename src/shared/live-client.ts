export interface LiveSessionAnswer {
  sessionId: string;
  sdp: string;
  model: "gpt-live-1";
  orderingEnabled: false;
  voiceSessionId?: string;
  expiresAt?: string;
}

export interface LiveAudioOptions {
  signal?: AbortSignal;
  onState?: (state: "connecting" | "listening" | "closed" | "error") => void;
  onTranscript?: (text: string) => void;
  onPlaybackBlocked?: () => void;
  // Must call the authenticated close endpoint with voiceSessionId, not a provider key.
  endSession?: (answer: LiveSessionAnswer) => Promise<void>;
}

// Fragments are not complete turns. Never infer confirmation from this buffer.
export function liveTranscriptBuffer(maxLength = 4000) {
  let text = "";
  const seen = new Set<string>();
  return {
    append(input: unknown): string | null {
      if (!input || typeof input !== "object") return null;
      const event = input as Record<string, unknown>;
      if (event.type !== "session.input_transcript.delta" || typeof event.event_id !== "string" || typeof event.delta !== "string") return null;
      if (seen.has(event.event_id)) return null;
      if (seen.size >= 2000 || text.length + event.delta.length > maxLength) throw new Error("Voice transcript is full. Review this order before continuing.");
      seen.add(event.event_id);
      text += event.delta;
      return text;
    },
    text: () => text,
  };
}

// Invoke on Start. An AbortController permits End even while mic permission or SDP
// is pending. Review uses a snapshot of transcript(), not every incoming fragment.
export async function connectLiveAudio(
  audio: HTMLAudioElement,
  createSession: (sdp: string, signal?: AbortSignal) => Promise<LiveSessionAnswer>,
  options: LiveAudioOptions = {},
) {
  const pc = new RTCPeerConnection();
  const events = pc.createDataChannel("oai-events");
  const transcript = liveTranscriptBuffer();
  let stream: MediaStream | undefined, answer: LiveSessionAnswer | undefined;
  let transportClosed = false;
  let closed = false, ending: Promise<void> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const endProvider = () => {
    if (answer && options.endSession && !ending) ending = options.endSession(answer).catch(error => { ending = undefined; throw error; });
    return ending ?? Promise.resolve();
  };
  const close = async () => {
    if (!closed) {
      closed = true;
      controller.abort();
      clearTimeout(expiry);
      options.signal?.removeEventListener("abort", abort);
      globalThis.removeEventListener?.("pagehide", abort);
      stream?.getTracks().forEach(track => track.stop());
      audio.pause();
      audio.srcObject = null;
      options.onState?.("closed");
    }
    try {
      if (answer && options.endSession) await endProvider();
      else if (events.readyState === "open") events.send(JSON.stringify({ type: "session.close" }));
    } catch (error) {
      try { if (events.readyState === "open") events.send(JSON.stringify({ type: "session.close" })); } catch { /* Transport is already lost. */ }
      throw error;
    } finally {
      if (!transportClosed) { transportClosed = true; events.close(); pc.close(); }
    }
  };
  const abort = () => { void close().catch(() => options.onState?.("error")); };
  const check = () => { if (closed || options.signal?.aborted) throw new Error("Voice connection cancelled."); };
  options.signal?.addEventListener("abort", abort, { once: true });
  globalThis.addEventListener?.("pagehide", abort, { once: true });
  events.onmessage = event => {
    if (closed || typeof event.data !== "string" || event.data.length > 32_000) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === "session.started") options.onState?.("listening");
      if (data.type === "session.closed") abort();
      if (data.type === "error") { options.onState?.("error"); abort(); }
      const value = transcript.append(data);
      if (value !== null) options.onTranscript?.(value);
    } catch { options.onState?.("error"); abort(); }
  };
  events.onclose = () => { if (!closed) abort(); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "disconnected") abort(); };
  try {
    check();
    options.onState?.("connecting");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    check();
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    pc.ontrack = event => {
      if (closed) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => options.onPlaybackBlocked?.());
    };
    await pc.setLocalDescription(await pc.createOffer());
    check();
    if (pc.iceGatheringState !== "complete") {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); pc.removeEventListener("icegatheringstatechange", listener); controller.signal.removeEventListener("abort", cancelled); };
        const cancelled = () => { cleanup(); reject(new Error("Voice connection cancelled.")); };
        const listener = () => { if (pc.iceGatheringState === "complete") { cleanup(); resolve(); } };
        const timeout = setTimeout(() => { cleanup(); reject(new Error("Voice connection timed out.")); }, 10_000);
        pc.addEventListener("icegatheringstatechange", listener);
        controller.signal.addEventListener("abort", cancelled, { once: true });
        if (controller.signal.aborted) cancelled(); else listener();
      });
    }
    check();
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("No audio offer was created.");
    answer = await createSession(sdp, controller.signal);
    check();
    // A UI timer supports the supervised demo; it is not a server spending limit.
    const remaining = answer.expiresAt ? Date.parse(answer.expiresAt) - Date.now() : 600_000;
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Voice session expired.");
    expiry = setTimeout(abort, Math.min(remaining, 600_000));
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    check();
    return { ...answer, peerConnection: pc, close, transcript: transcript.text,
      setMicrophoneEnabled(enabled: boolean) {
        if (closed) return;
        stream?.getAudioTracks().forEach(track => { track.enabled = enabled; });
      },
    };
  } catch (error) {
    // A permission request can resolve after End; stop those late tracks too.
    stream?.getTracks().forEach(track => track.stop());
    await close().catch(() => options.onState?.("error"));
    throw error;
  }
}
