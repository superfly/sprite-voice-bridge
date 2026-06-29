# Sprite Voice Bridge

![Sprite Voice Bridge](docs/header.jpg)

Stream your **local microphone** into a headless [Fly.io Sprite](https://fly.io/sprites)
so that Claude Code's `/voice` — or any ALSA recorder running on the Sprite —
can hear you.

A Sprite is a remote sandbox with no audio hardware, so `/voice` has no
microphone to record from. This bridge gives it a *virtual* one: a small web app
captures your mic in the browser, streams the audio over a WebSocket to the
Sprite, and exposes it there as a normal ALSA capture device.

```
┌─ your browser ─────────────┐         ┌─ the Sprite ───────────────────────────────┐
│ getUserMedia (16 kHz mono) │         │                                            │
│        │ s16le PCM         │  WSS    │  server.js ──▶ mic.fifo                     │
│        ▼                   │ ──────▶ │      │                                     │
│  WebSocket  /ws            │         │      ▼                                     │
└────────────────────────────┘         │  PulseAudio "micbridge" pipe-source        │
                                        │      │  (~/.asoundrc routes ALSA default) │
                                        │      ▼                                     │
                                        │  arecord  ◀── what Claude Code /voice runs │
                                        └────────────────────────────────────────────┘
```

The UI is a [Vite](https://vitejs.dev) + React app built with
[ElevenLabs UI](https://ui.elevenlabs.io) and [shadcn/ui](https://ui.shadcn.com).

## Prerequisites

- A Fly.io Sprite you can run commands in (the `sprite-env` CLI is present).
- [Bun](https://bun.sh) and `sudo apt-get` available inside the Sprite.
- The Sprite's public URL open in a browser that can reach your microphone
  (any modern Chrome/Firefox/Edge; Safari needs a caveat — see Troubleshooting).

## Quick start

From inside the Sprite:

```bash
git clone https://github.com/superfly/sprite-voice-bridge.git
cd sprite-voice-bridge
./setup.sh
```

`setup.sh` installs PulseAudio + ALSA, builds the web UI, wires `~/.asoundrc`,
and registers three `sprite-env` services. When it finishes it prints your
Sprite URL.

Then:

1. Open the Sprite URL in your browser and click **Start microphone** (allow mic
   access). Keep the tab open — the waveform should react when you talk.
2. In your Claude Code terminal, run `/voice` and use push-to-talk.

> The browser tab must be actively streaming the whole time you want to use
> voice. The terminal's push-to-talk only decides *when* `arecord` reads from
> the now-live mic.

## How it works

Claude Code's `/voice` records via `arecord` against the **default ALSA capture
device**. This project makes that default device real on a machine with no sound
card:

1. **`start-pulse.sh`** runs a headless PulseAudio whose only source,
   `micbridge`, is a `module-pipe-source` backed by a FIFO. It feeds silence on
   underrun, so the device is always openable.
2. **`server.js`** serves the web UI and accepts raw 16 kHz mono `s16le` PCM over
   `/ws`, writing it straight into the FIFO.
3. **`~/.asoundrc`** points the ALSA `default` device at this PulseAudio
   instance, so `arecord` (and the rest of ALSA) read `micbridge` with no extra
   flags or environment.
4. **`drain.sh`** runs a `parec` that continuously reads `micbridge`. This is
   essential: `module-pipe-source` only drains the FIFO *while a recorder is
   attached*, so without a constant drain the browser audio backs up and
   `arecord` later plays out stale backlog ("No speech detected"). The server
   also drops PCM if its FIFO buffer grows past ~1.5 s, as a backstop.

### Services

`setup.sh` registers three Sprite services:

| Service        | What it does                                             |
| -------------- | -------------------------------------------------------- |
| `voice-pulse`  | Headless PulseAudio with the `micbridge` pipe-source     |
| `voice-drain`  | Keeps `micbridge` drained in real time (`parec`)         |
| `voice-bridge` | Node server: serves the UI + `/ws`, holds `--http-port`  |

```bash
sprite-env services list
sprite-env services restart voice-bridge
# logs: /.sprite/logs/services/voice-{pulse,drain,bridge}.log
```

### Developing the UI

```bash
cd web
bun install
bun run build          # output → web/dist, served by server.js
sprite-env services restart voice-bridge
```

UI components were added with the [shadcn](https://ui.shadcn.com) CLI, e.g.:

```bash
bunx shadcn@latest add @dotmatrix/dotm-square-11
```

`web/src/useVoiceBridge.ts` owns the WebSocket + PCM pipeline; `web/src/App.tsx`
is the page.

## Configuration

| Variable     | Default                      | Used by                          |
| ------------ | ---------------------------- | -------------------------------- |
| `BRIDGE_DIR` | the repo directory           | all scripts + `server.js`        |
| `PORT`       | `8080`                       | `server.js`                      |
| `MIC_FIFO`   | `$BRIDGE_DIR/mic.fifo`       | `server.js`                      |

All paths derive from the repo location, so you can clone it anywhere.

## Troubleshooting

- **"No speech detected"** — make sure the browser tab shows a moving waveform
  while you talk, and that `voice-drain` is running
  (`sprite-env services list`). Check `voice-bridge.log` for `client connected`.
- **Silent on Safari** — Safari is picky about non-default `AudioContext` sample
  rates. Use Chrome/Firefox, or open an issue to add a resampling fallback.
- **Page won't load** — the Sprite proxy may auth-gate the URL; open it in the
  browser where you're signed in to Fly.io.

## Credits

UI components come from [ElevenLabs UI](https://github.com/elevenlabs/ui)
(Live Waveform, Voice Button), [Dot Matrix](https://dotmatrix.zzzzshawn.cloud)
(the `dotm-square-11` listening indicator), and [shadcn/ui](https://ui.shadcn.com)
(Button, shimmer utility).

The header image was generated with OpenAI's gpt-image.

## License

[MIT](./LICENSE) © Fly.io
