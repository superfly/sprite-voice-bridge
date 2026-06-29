import { Mic } from "lucide-react"
import { LiveWaveform } from "@/components/ui/live-waveform"
import { VoiceButton, type VoiceButtonState } from "@/components/ui/voice-button"
import { DotmSquare11 } from "@/components/ui/dotm-square-11"
import { useVoiceBridge } from "@/useVoiceBridge"

export default function App() {
  const { recording, status, error, toggle, onStreamReady, onStreamEnd, onError } =
    useVoiceBridge()

  const btnState: VoiceButtonState =
    status === "connecting" ? "processing" : status === "error" ? "error" : "idle"

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-10 overflow-hidden bg-background px-6 py-12">
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl transition-opacity duration-700"
        style={{
          background: "radial-gradient(circle, #2b4a7a 0%, transparent 70%)",
          opacity: recording ? 0.55 : 0.2,
        }}
      />

      <header className="flex flex-col items-center gap-3 text-center">
        <img
          src="/header.jpg"
          alt="Sprite Voice Bridge"
          className="mb-1 w-full max-w-md rounded-xl border border-border shadow-lg"
        />
        <h1 className="text-2xl font-semibold tracking-tight">Sprite Voice Bridge</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Streams this device's microphone to the headless sprite so Claude Code{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/voice</code> can hear you.
        </p>
      </header>

      {/* status line — shimmer only on "Listening…" */}
      <div className="flex h-6 items-center">
        {recording ? (
          <span className="shimmer text-sm font-medium">Listening…</span>
        ) : status === "connecting" ? (
          <span className="text-sm font-medium text-muted-foreground">Connecting…</span>
        ) : status === "error" ? (
          <span className="text-sm font-medium text-destructive">{error}</span>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">
            Idle — start to stream your mic to the sprite
          </span>
        )}
      </div>

      {/* live mic waveform — owns the single MediaStream we tap for PCM */}
      <div className="w-full max-w-md rounded-xl border border-border bg-card/40 px-4 py-3 backdrop-blur">
        <LiveWaveform
          active={recording}
          height={64}
          barColor={recording ? "#7DD3FC" : undefined}
          onStreamReady={onStreamReady}
          onStreamEnd={onStreamEnd}
          onError={onError}
        />
      </div>

      {/* control — dot-matrix loader shows in the button while listening */}
      <VoiceButton
        state={btnState}
        size="lg"
        variant={recording ? "destructive" : "default"}
        onPress={toggle}
        icon={<Mic className="size-4" />}
        label={recording ? "Stop microphone" : "Start microphone"}
        trailing={recording ? <DotmSquare11 size={18} color="currentColor" /> : undefined}
      />

      <footer className="absolute bottom-4 text-xs text-muted-foreground/60">
        browser → WebSocket → PulseAudio → arecord → /voice
      </footer>
    </div>
  )
}
