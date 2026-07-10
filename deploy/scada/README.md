# R-Net — Server-Side Streaming Stack

Developer notes. Operator guides (Indonesian):

- **`install.ps1`** — universal one-command installer. On any Windows machine,
  copy this `deploy/scada/` folder there and run
  `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1`. It
  downloads MediaMTX + cloudflared from their **official GitHub releases**
  (cloudflared verified by Authenticode signature; MediaMTX zip SHA-256
  printed), generates `mediamtx.yml` + `config.env` (incl. `STREAM_NAME` so
  multiple broadcast machines never overwrite each other's stream URL), and
  **optionally installs Mosquitto** (official mosquitto.org installer:
  account, `mosquitto.conf`, firewall port 1883). No Python, no REIN repo;
  only the optional Mosquitto step asks for admin once, and its Windows
  service is set to Manual — everything starts/stops ONLY via the switches
  (`start-scada.bat` / `stop-scada.bat` now also cover the MQTT broker).
  Re-runnable; never clobbers existing
  `mediamtx.yml`/`config.env`/`mosquitto.conf`.
- **[PANDUAN-INSTALASI-STREAMING.md](./PANDUAN-INSTALASI-STREAMING.md)** —
  the same install done by hand (for people who prefer step-by-step), plus the
  every-boot routine and stream registration in R-Net.
- [PANDUAN-SERVER-SCADA.md](./PANDUAN-SERVER-SCADA.md) — the 24/7 server-PC
  variant: NSSM services + named tunnel (fixed URL), zero manual steps after
  reboot.
- **[PANDUAN-MQTT-RNET.md](./PANDUAN-MQTT-RNET.md)** — the **sensor-data** side
  (separate from video): broker → V-Net/V-Box → R-Net Analisis, including tag
  scaling/calibration and alarms. The MQTT bridge installs on the SAME server as
  the streaming stack. Technical bridge notes: `mqtt-bridge/README.md`.
- [TUTORIAL-TES-LOKAL.md](./TUTORIAL-TES-LOKAL.md) — local dev smoke test.

## Architecture

```
OBS ──RTMP (127.0.0.1:1935)──▶ MediaMTX ──LL-HLS (127.0.0.1:8888)──▶ cloudflared ──▶ https://scada-stream.<domain>
                                                                                          │
                                                              REIN /scada page (hls.js) ◀┘
```

- **Why HLS, not WebRTC:** Cloudflare Tunnel only carries HTTP/HTTPS/WebSocket.
  WebRTC media (ICE over UDP/TCP) does not traverse it. LL-HLS gives ~3–6 s
  latency, acceptable for monitoring. If LL-HLS misbehaves through the proxy,
  set `hlsVariant: mpegts` in `mediamtx.yml` (~6–10 s latency).
- **Auth:** MediaMTX `authInternalUsers` — publisher (`obs`) is IP-locked to
  localhost; reader (`rein-viewer`) credentials are stored in REIN's
  `scada_streams` table and sent by the player as an `Authorization: Basic`
  header on every request (query-param auth is NOT supported for HLS reads
  in modern MediaMTX — verified on v1.19; RTMP publish still accepts
  `?user=&pass=` in the stream key). Anonymous access is denied. CORS is
  locked to the REIN frontend origin.
- **Self-healing:** MediaMTX + cloudflared run as NSSM services
  (`AppExitAction Restart`, 5 s delay). OBS runs via a logon scheduled task
  with `--startstreaming` (it needs a desktop session, so it cannot be a
  service; Windows auto-logon is required). The REIN video panel retries
  forever with capped backoff and has a stale-frame watchdog.
- **OBS keyframe interval must be 1 s** to match `hlsSegmentDuration`.

## Files

| File | Purpose |
|---|---|
| `install.ps1` | **Universal installer** — downloads deps, generates config, installs switches. Manual-switch (laptop/quick-tunnel) mode. |
| `start-scada.ps1` / `stop-scada.ps1` | Runtime switches (PowerShell-native Supabase PATCH — no Python/repo). `.bat` wrappers double-click these. |
| `config.env.example` | Template for `config.env` (Supabase URL + service key). Real `config.env` is git-ignored. |
| `mediamtx.yml` | MediaMTX config template (RTMP ingest, LL-HLS output, auth) — MediaMTX ≥ 1.9; `GANTI_*` filled by installer |
| `cloudflared-config.yml` | Named-tunnel ingress template (server/24-7 mode) |
| `install-services.ps1` | Idempotent NSSM + Task Scheduler installer (server/24-7 mode) |
| `PANDUAN-SERVER-SCADA.md` | Non-technical server setup guide (Indonesian) |

The old `update_stream_url.py` (Python, imported the REIN repo) is **retired** —
its job (PATCH `scada_streams.hls_url`) is now a native `Invoke-RestMethod`
call inside `start-scada.ps1`, so client machines need only PowerShell.

## Future: client deployments (Docker)

MediaMTX (`bluenviron/mediamtx`) and cloudflared (`cloudflare/cloudflared`)
both ship official images; the yml files here map 1:1 to container configs.
OBS stays on the host (needs GPU/desktop) and publishes RTMP to the
container's mapped port.
