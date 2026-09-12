import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Send, Pause, Play } from 'lucide-react';

/**
 * Voice recorder built on MediaRecorder.
 *
 * Notes that cost time if you do not know them:
 *  - getUserMedia only works on https or localhost. On a phone over the LAN
 *    it silently fails, which is why the error text says so explicitly.
 *  - Chrome gives audio/webm, Safari gives audio/mp4. We ask for webm and
 *    fall back rather than assuming.
 *  - The stream tracks must be stopped by hand or the browser keeps the
 *    microphone indicator on after recording.
 */
const MAX_SECONDS = 300;

const pickMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
};

const fmt = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function VoiceRecorder({ onSubmit, busy }) {
  const [state, setState] = useState('idle'); // idle | recording | paused | recorded
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  // Release the microphone and the object URL on unmount.
  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio. Try Chrome or Safari.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
        setState('recorded');
        streamRef.current?.getTracks().forEach((t) => t.stop());
      };

      rec.start(1000);
      setState('recording');
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            clearInterval(timerRef.current);
            recorderRef.current?.stop();
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      clearInterval(timerRef.current);
      if (err.name === 'NotAllowedError')
        setError('Microphone access was blocked. Allow it in your browser settings and try again.');
      else if (err.name === 'NotFoundError')
        setError('No microphone was found on this device.');
      else if (!window.isSecureContext)
        setError('Recording needs a secure connection. Use localhost or an https address.');
      else setError(`Could not start recording: ${err.message}`);
      setState('idle');
    }
  };

  const stop = () => {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
  };

  const pause = () => {
    recorderRef.current?.pause();
    clearInterval(timerRef.current);
    setState('paused');
  };

  const resume = () => {
    recorderRef.current?.resume();
    setState('recording');
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  const discard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setBlob(null);
    setPreviewUrl(null);
    setSeconds(0);
    setState('idle');
    setPlaying(false);
  };

  const send = () => blob && onSubmit(blob, seconds);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
    setPlaying(!playing);
  };

  return (
    <div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <div className="flex flex-col items-center py-6">
        {/* The timer is the main feedback while recording, so it is large. */}
        <p
          className={`text-4xl font-extrabold tabular-nums tracking-tight ${
            state === 'recording' ? 'text-tide-700' : 'text-ink'
          }`}
        >
          {fmt(seconds)}
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          {state === 'recording'
            ? `Recording, up to ${fmt(MAX_SECONDS)}`
            : state === 'paused'
              ? 'Paused'
              : state === 'recorded'
                ? 'Listen back before you send it'
                : `Take as long as you need, up to ${fmt(MAX_SECONDS)}`}
        </p>

        {state === 'recording' && (
          <div className="mt-5 flex items-end gap-1 h-8" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-1.5 bg-tide-500 rounded-pill animate-pulse"
                style={{ height: `${40 + i * 12}%`, animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}

        <div className="mt-7 flex items-center gap-3">
          {state === 'idle' && (
            <button onClick={start} className="btn-primary h-14 px-8 text-base" disabled={busy}>
              <Mic size={20} />
              Start recording
            </button>
          )}

          {state === 'recording' && (
            <>
              <button onClick={pause} className="btn-quiet h-12 px-5" aria-label="Pause">
                <Pause size={18} />
              </button>
              <button onClick={stop} className="btn-primary h-12 px-6">
                <Square size={16} />
                Done
              </button>
            </>
          )}

          {state === 'paused' && (
            <>
              <button onClick={resume} className="btn-quiet h-12 px-5">
                <Play size={18} />
                Resume
              </button>
              <button onClick={stop} className="btn-primary h-12 px-6">
                <Square size={16} />
                Done
              </button>
            </>
          )}

          {state === 'recorded' && (
            <>
              <button onClick={togglePlay} className="btn-quiet h-12 px-5">
                {playing ? <Pause size={18} /> : <Play size={18} />}
                {playing ? 'Pause' : 'Listen'}
              </button>
              <button onClick={discard} className="btn-quiet h-12 px-5" disabled={busy}>
                <Trash2 size={17} />
                Discard
              </button>
              <button onClick={send} className="btn-primary h-12 px-6" disabled={busy}>
                <Send size={17} />
                {busy ? 'Processing…' : 'Save entry'}
              </button>
            </>
          )}
        </div>

        {previewUrl && (
          <audio
            ref={audioRef}
            src={previewUrl}
            onEnded={() => setPlaying(false)}
            className="sr-only"
          />
        )}
      </div>
    </div>
  );
}
