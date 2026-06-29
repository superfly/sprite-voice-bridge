import { LiveWaveform } from "@/components/ui/live-waveform"
import { Button } from "@/components/ui/button"
import { DotmSquare11 } from "@/components/ui/dotm-square-11"
import { useVoiceBridge } from "@/useVoiceBridge"

export default function App() {
  const { recording, status, error, toggle, onStreamReady, onStreamEnd, onError } =
    useVoiceBridge()

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

      {/* status line — Dot Matrix loader in front of a shimmering "Listening…" */}
      <div className="flex h-9 items-center">
        {recording ? (
          <span className="inline-flex items-center gap-2.5">
            <DotmSquare11 size={32} dotSize={4} speed={1.2} bloom />
            <span className="shimmer text-sm font-medium">Listening…</span>
          </span>
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

      {/* control — label only */}
      <Button
        size="lg"
        variant={recording ? "destructive" : "default"}
        onClick={toggle}
      >
        {recording ? "Stop microphone" : "Start microphone"}
      </Button>

      <footer className="absolute bottom-4 flex items-center gap-2.5 text-xs text-muted-foreground/60">
        <span>browser → WebSocket → PulseAudio → arecord → /voice</span>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/superfly/sprite-voice-bridge"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.76-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub
        </a>
      </footer>
    </div>
  )
}
