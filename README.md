<div align="center">

<img src="docs/header.jpg" alt="Sprite Voice Bridge" width="100%" />

<h1>🎙️&nbsp; Sprite Voice Bridge</h1>

<p>
  <strong>Give your headless <a href="https://fly.io/sprites">Fly.io&nbsp;Sprite</a> a microphone.</strong><br/>
  Stream your local mic into a remote sandbox so Claude&nbsp;Code <code>/voice</code> — and any ALSA recorder — can hear you.
</p>

<p>
  <a href="https://github.com/superfly/sprite-voice-bridge/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square" /></a>
  <img alt="Runtime: Bun" src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=black" />
  <img alt="UI: React + Vite" src="https://img.shields.io/badge/UI-React%20+%20Vite-61dafb?style=flat-square&logo=react&logoColor=black" />
  <img alt="Platform: Fly.io Sprites" src="https://img.shields.io/badge/Fly.io-Sprites-8b5cf6?style=flat-square" />
</p>

<p>
  <a href="#quick-start"><b>Quick start</b></a> &nbsp;·&nbsp;
  <a href="#how-it-works"><b>How it works</b></a> &nbsp;·&nbsp;
  <a href="#connecting-public-url-vs-sprite-proxy"><b>Connecting</b></a> &nbsp;·&nbsp;
  <a href="#troubleshooting"><b>Troubleshooting</b></a>
</p>

</div>

---

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
and registers three `sprite-env` services. When it finishes it prints how to
open the page.

Then:

1. Open the page in your browser and click **Start microphone** (allow mic
   access). Keep the tab open — the waveform should react when you talk.
2. In your Claude Code terminal, run `/voice` and use push-to-talk.

## Connecting: public URL vs. `sprite proxy`

The bridge needs to be reachable from your browser. There are two ways, chosen
by the argument to `setup.sh`:

### `./setup.sh http` (default) — public Sprite URL

Registers the server with `--http-port 8080`, so the Sprite proxy serves it at
your public Sprite URL (`https://<sprite>.sprites.app/`). Simplest, but it
**consumes the Sprite's single `--http-port` slot** — if you need that slot for
your actual app, use proxy mode instead.

### `./setup.sh proxy` — local tunnel, no public slot

Registers the server **without** `--http-port`, leaving your public slot free.
Reach it with a local TCP tunnel from your machine:

```bash
sprite proxy 8080          # forwards localhost:8080 → the sprite
```

Then open **http://localhost:8080/**. No HTTPS is needed: browsers treat
`http://localhost` as a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts),
so `getUserMedia` and WebSockets work over plain `http`/`ws`. This is also more
private — nothing is exposed publicly, and the tunnel needs your authenticated
Sprites CLI.

> The web app picks `ws://` or `wss://` automatically from the page URL, so the
> same build works in both modes — only the service registration differs.

To switch an existing install between modes, just re-run `setup.sh` with the
other argument.

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

Vendored UI components live under `web/src/components/ui/`; `web/src/index.css`
holds the theme tokens and animation keyframes. `web/src/useVoiceBridge.ts` owns
the WebSocket + PCM pipeline; `web/src/App.tsx` is the page.

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
(Live Waveform, Voice Button) and [shadcn/ui](https://ui.shadcn.com)
(Button, shimmer utility). The in-button "listening" scanner is a small custom
component (`web/src/components/ui/pixel-scanner.tsx`).

The header image was generated with OpenAI's gpt-image.

## License

[MIT](./LICENSE) © Fly.io
