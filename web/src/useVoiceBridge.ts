import { useCallback, useMemo, useRef, useState } from "react"

export type BridgeStatus = "idle" | "connecting" | "streaming" | "error"

const SAMPLE_RATE = 16000
const CONNECT_TIMEOUT_MS = 8000

/**
 * Owns the WebSocket + PCM pipeline that feeds the remote sprite's virtual mic.
 *
 * The mic MediaStream itself is owned by the <LiveWaveform> component (so we get
 * its visualization for free); we tap it via onStreamReady, resample to
 * 16 kHz mono s16le in a dedicated AudioContext, and ship raw PCM over /ws.
 *
 * `wsRef.current` is the single source of truth for "a session is active"
 * (connecting OR streaming) and is set/cleared synchronously, so rapid toggles
 * and the M shortcut can never open a second socket or orphan the first.
 */
export function useVoiceBridge() {
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState<BridgeStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const connectTimerRef = useRef<number | null>(null)
  const resampleRef = useRef({ pos: 0 })
  const nodesRef = useRef<{
    src?: MediaStreamAudioSourceNode
    proc?: ScriptProcessorNode
    mute?: GainNode
  }>({})

  const teardownAudio = useCallback(() => {
    const { src, proc, mute } = nodesRef.current
    try { proc?.disconnect() } catch {}
    try { src?.disconnect() } catch {}
    try { mute?.disconnect() } catch {}
    nodesRef.current = {}
    resampleRef.current.pos = 0
    const ctx = ctxRef.current
    ctxRef.current = null
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {})
  }, [])

  const closeWs = useCallback(() => {
    if (connectTimerRef.current !== null) {
      clearTimeout(connectTimerRef.current)
      connectTimerRef.current = null
    }
    const ws = wsRef.current
    wsRef.current = null
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close() } catch {}
    }
  }, [])

  // Tear everything down (used by stop, cancel, and every failure path).
  const stop = useCallback(
    (nextStatus: BridgeStatus) => {
      closeWs()
      teardownAudio()
      setRecording(false)
      setStatus(nextStatus)
    },
    [closeWs, teardownAudio],
  )

  /** Called by <LiveWaveform onStreamReady>. Wires the tapped mic into PCM→WS. */
  const onStreamReady = useCallback((stream: MediaStream) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      }) as AudioContext
      ctxRef.current = ctx
      if (ctx.state === "suspended") ctx.resume().catch(() => {})

      // Some engines (e.g. older Safari) ignore the requested sampleRate, so
      // resample to 16 kHz ourselves rather than ship wrong-pitch audio.
      const inRate = ctx.sampleRate
      const ratio = inRate / SAMPLE_RATE
      resampleRef.current.pos = 0

      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(2048, 1, 1)
      const mute = ctx.createGain()
      mute.gain.value = 0
      nodesRef.current = { src, proc, mute }

      proc.onaudioprocess = (e) => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const f32 = e.inputBuffer.getChannelData(0)

        let samples: Float32Array | number[] = f32
        if (inRate !== SAMPLE_RATE) {
          const out: number[] = []
          let pos = resampleRef.current.pos
          for (; pos < f32.length; pos += ratio) {
            const i = pos | 0
            const frac = pos - i
            const a = f32[i]
            const b = i + 1 < f32.length ? f32[i + 1] : f32[i]
            out.push(a + (b - a) * frac)
          }
          resampleRef.current.pos = pos - f32.length
          samples = out
        }

        const i16 = new Int16Array(samples.length)
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]))
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        ws.send(i16.buffer)
      }

      // ScriptProcessor only fires while connected to the graph's destination;
      // route through a muted gain so we don't echo the mic to the speakers.
      src.connect(proc)
      proc.connect(mute)
      mute.connect(ctx.destination)
      setStatus("streaming")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      stop("error")
    }
  }, [stop])

  const onStreamEnd = useCallback(() => {
    teardownAudio()
  }, [teardownAudio])

  // <LiveWaveform> failed to open the mic (denied / insecure context / busy).
  // Tear the just-opened socket down too — otherwise it leaks and corrupts the
  // next start.
  const onError = useCallback(
    (err: Error) => {
      setError(err.message)
      stop("error")
    },
    [stop],
  )

  const toggle = useCallback(() => {
    // A press while connecting OR streaming stops/cancels the session.
    // wsRef is set synchronously below, so this guard is race-free.
    if (wsRef.current) {
      setError(null)
      stop("idle")
      return
    }

    setError(null)
    setStatus("connecting")
    const proto = location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.binaryType = "arraybuffer"
    wsRef.current = ws

    connectTimerRef.current = window.setTimeout(() => {
      if (wsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
        setError("Could not reach the bridge (timed out).")
        stop("error")
      }
    }, CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      if (wsRef.current !== ws) { try { ws.close() } catch {}; return }
      if (connectTimerRef.current !== null) {
        clearTimeout(connectTimerRef.current)
        connectTimerRef.current = null
      }
      setRecording(true) // drives <LiveWaveform active> → getUserMedia → onStreamReady
    }
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      teardownAudio()
      setRecording(false)
      setStatus((s) => (s === "error" ? s : "idle"))
    }
    ws.onerror = () => {
      if (wsRef.current !== ws) return
      setError("WebSocket connection failed.")
      stop("error")
    }
  }, [stop, teardownAudio])

  return useMemo(
    () => ({ recording, status, error, toggle, onStreamReady, onStreamEnd, onError }),
    [recording, status, error, toggle, onStreamReady, onStreamEnd, onError],
  )
}
