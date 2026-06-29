import { useCallback, useMemo, useRef, useState } from "react"

export type BridgeStatus = "idle" | "connecting" | "streaming" | "error"

const SAMPLE_RATE = 16000

/**
 * Owns the WebSocket + PCM pipeline that feeds the remote sprite's virtual mic.
 *
 * The mic MediaStream itself is owned by the <LiveWaveform> component (so we get
 * its visualization for free); we tap it via onStreamReady, resample to
 * 16 kHz mono s16le in a dedicated AudioContext, and ship raw PCM over /ws.
 */
export function useVoiceBridge() {
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState<BridgeStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
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
    const ctx = ctxRef.current
    ctxRef.current = null
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {})
  }, [])

  const closeWs = useCallback(() => {
    const ws = wsRef.current
    wsRef.current = null
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close() } catch {}
    }
  }, [])

  /** Called by <LiveWaveform onStreamReady>. Wires the tapped mic into PCM→WS. */
  const onStreamReady = useCallback((stream: MediaStream) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      }) as AudioContext
      ctxRef.current = ctx
      // Resume in case the browser created the context suspended.
      if (ctx.state === "suspended") ctx.resume().catch(() => {})

      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(2048, 1, 1)
      const mute = ctx.createGain()
      mute.gain.value = 0
      nodesRef.current = { src, proc, mute }

      proc.onaudioprocess = (e) => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const f32 = e.inputBuffer.getChannelData(0)
        const i16 = new Int16Array(f32.length)
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]))
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
      setStatus("error")
    }
  }, [])

  const onStreamEnd = useCallback(() => {
    teardownAudio()
  }, [teardownAudio])

  const onError = useCallback((err: Error) => {
    setError(err.message)
    setStatus("error")
    setRecording(false)
  }, [])

  const toggle = useCallback(() => {
    if (recording) {
      setRecording(false)
      teardownAudio()
      closeWs()
      setStatus("idle")
      return
    }
    // Start: open the WS first, then flip recording so LiveWaveform opens the mic.
    setError(null)
    setStatus("connecting")
    const proto = location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.binaryType = "arraybuffer"
    wsRef.current = ws
    ws.onopen = () => setRecording(true)
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null
        setRecording(false)
        teardownAudio()
        setStatus((s) => (s === "error" ? s : "idle"))
      }
    }
    ws.onerror = () => {
      setError("WebSocket connection failed")
      setStatus("error")
      setRecording(false)
    }
  }, [recording, teardownAudio, closeWs])

  return useMemo(
    () => ({ recording, status, error, toggle, onStreamReady, onStreamEnd, onError }),
    [recording, status, error, toggle, onStreamReady, onStreamEnd, onError]
  )
}
