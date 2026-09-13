export interface LiveSessionAnswer {
  sessionId: string;
  sdp: string;
  model: "gpt-live-1";
  orderingEnabled: false;
  voiceSessionId?: string;
  expiresAt?: string;
}

/** Finite playback on a context unlocked by staff Start. Abort never counts as ended. */
export async function playVoiceReadback(context: AudioContext, bytes: Uint8Array, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Voice stopped.");
  const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
  if (signal.aborted || context.state !== "running" || buffer.duration <= 0 || buffer.duration > 120) throw new Error("Voice playback is unavailable.");
  await new Promise<void>((resolve, reject) => {
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    let stopped = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); source.disconnect(); };
    const abort = () => { if (stopped) return; stopped = true; source.onended = null; try { source.stop(); } catch {} cleanup(); reject(new Error("Voice playback interrupted.")); };
    const timer = setTimeout(abort, (buffer.duration + 5) * 1000);
    source.onended = () => { if (stopped) return; stopped = true; cleanup(); if (signal.aborted || context.state !== "running") reject(new Error("Voice playback interrupted.")); else resolve(); };
    signal.addEventListener("abort", abort, { once: true }); source.start();
  });
}

/** Audio-level framing, never a semantic approval or a GPT-Live turn event. */
export function voiceCaptureBoundary(rate: number) {
  let offset = 0, voiced = 0, lastVoice = 0;
  return {
    push(input: Float32Array): boolean {
      const length = Math.min(input.length, rate * 8 - offset);
      // Ignore the short capture cue before detecting customer speech.
      const begin = Math.max(0, Math.ceil(rate * 0.4 - offset));
      let energy = 0;
      for (let i = begin; i < length; i++) energy += input[i] ** 2;
      offset += length;
      if (length > begin && Math.sqrt(energy / (length - begin)) > 0.015) { voiced += length - begin; lastVoice = offset; }
      return offset >= rate * 8 || (offset >= rate * 1.25 && voiced >= rate * 0.2 && offset - lastVoice >= rate);
    },
  };
}

/** Capture a separately framed answer: speech followed by one second of quiet,
 * at most eight seconds. Only the resulting complete file is transcribed. */
export async function recordVoiceConfirmation(context: AudioContext, signal: AbortSignal): Promise<Uint8Array> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new Error("Voice stopped."); }
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const rate = context.sampleRate, count = rate * 8, samples = new Int16Array(count);
      let offset = 0, done = false;
      const boundary = voiceCaptureBoundary(rate);
      const source = context.createMediaStreamSource(stream);
      // Local operator harness: ScriptProcessor permits bounded PCM capture without
      // loading an unversioned worklet. Replace with an AudioWorklet for deployment.
      const processor = context.createScriptProcessor(4096, 1, 1), silent = context.createGain(); silent.gain.value = 0;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); processor.onaudioprocess = null; source.disconnect(); processor.disconnect(); silent.disconnect(); };
      const abort = () => { if (done) return; done = true; cleanup(); reject(new Error("The answer recording was interrupted.")); };
      const timer = setTimeout(abort, 11_000);
      signal.addEventListener("abort", abort, { once: true });
      processor.onaudioprocess = event => {
        if (done) return;
        if (signal.aborted || context.state !== "running") { abort(); return; }
        const input = event.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length && offset < count; i++) samples[offset++] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
        if (boundary.push(input)) {
          done = true; cleanup();
          const captured = samples.subarray(0, offset);
          const wav = new Uint8Array(44 + captured.byteLength), view = new DataView(wav.buffer);
          const word = (at: number, text: string) => { for (let i = 0; i < text.length; i++) wav[at + i] = text.charCodeAt(i); };
          word(0, "RIFF"); view.setUint32(4, wav.length - 8, true); word(8, "WAVE"); word(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, captured.byteLength, true);
          for (let i = 0; i < captured.length; i++) view.setInt16(44 + i * 2, captured[i], true);
          resolve(wav);
        }
      };
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      // Audible capture cue avoids losing the answer while a fresh microphone
      // stream is opening. This short tone is not an approval or model event.
      const cue = context.createOscillator(), volume = context.createGain();
      cue.frequency.value = 660; volume.gain.value = 0.06;
      cue.connect(volume); volume.connect(context.destination);
      cue.onended = () => { cue.disconnect(); volume.disconnect(); };
      cue.start(context.currentTime + 0.1); cue.stop(context.currentTime + 0.22);
    });
  } finally { stream.getTracks().forEach(track => track.stop()); }
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
  let started = false;
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
      if (data.type === "session.started") { started = true; options.onState?.("listening"); }
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
      async waitUntilStarted() {
        check();
        if (started) return;
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); events.removeEventListener("message", ready); controller.signal.removeEventListener("abort", cancelled); };
          const ready = () => { if (started) { cleanup(); resolve(); } };
          const cancelled = () => { cleanup(); reject(new Error("Voice connection cancelled.")); };
          const timer = setTimeout(() => { cleanup(); reject(new Error("Voice connection timed out.")); }, 15000);
          events.addEventListener("message", ready); controller.signal.addEventListener("abort", cancelled, { once: true });
          if (controller.signal.aborted) cancelled(); else ready();
        });
      },
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
