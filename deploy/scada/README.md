# R-Net — Server-Side Stack (streaming + MQTT + tooling)

Developer notes. **Operator guide (Indonesian): [PANDUAN-RNET.md](./PANDUAN-RNET.md)**
— the single guide covering install, OBS, MQTT, Node-RED, and troubleshooting
(replaces the old PANDUAN-INSTALASI-STREAMING / PANDUAN-SERVER-SCADA /
PANDUAN-MQTT-RNET / TUTORIAL-TES-LOKAL set).

## Architecture

```
video : OBS ──RTMP (127.0.0.1:1935)──▶ MediaMTX ──LL-HLS (127.0.0.1:8888)──▶ cloudflared ──▶ R-Net player
data  : V-Box ──MQTT──▶ Mosquitto (1883) ──▶ mqtt-bridge ──▶ Supabase scada_samples ──▶ R-Net panels
```

- **Why HLS through the tunnel:** Cloudflare Tunnel only carries
  HTTP/HTTPS/WS; WebRTC media doesn't traverse it. LL-HLS gives ~3–6 s.
  Sub-second playback (WebRTC/WHEP) runs through the VPS relay instead —
  see `deploy/vps/`.
- **Auth:** MediaMTX `authInternalUsers` — publisher (`obs`) IP-locked to
  localhost; reader (`rein-viewer`) credentials live in REIN's
  `scada_streams` table and are sent as `Authorization: Basic` (query-param
  auth is NOT supported for HLS reads in modern MediaMTX; RTMP publish still
  accepts `?user=&pass=`). Anonymous denied; CORS locked to the REIN origin.
- **No autostart anywhere** (user preference): everything runs via manual
  switches; Mosquitto's Windows service is forced to `Manual`.
- **OBS keyframe interval must be 1 s** to match `hlsSegmentDuration`.

## Files

| File | Purpose |
|---|---|
| `install.ps1` | **Universal installer** with a component menu: [1] MediaMTX+cloudflared (latest GitHub releases; cloudflared Authenticode-verified, MediaMTX SHA-256 printed), [2] Mosquitto, [3] Node-RED (Node.js LTS + npm), [4] OBS — 2–4 via winget (latest). Idempotent; never clobbers `mediamtx.yml`/`config.env`/`mosquitto.conf`. |
| `start-scada.ps1` / `stop-scada.ps1` (+ `.bat`) | Runtime switches: MediaMTX + Quick Tunnel + Mosquitto; PowerShell-native Supabase PATCH of `scada_streams.hls_url` (no Python/repo needed). |
| `mqtt-setting.ps1` + `Pengaturan MQTT.bat` | **WinForms GUI** for Mosquitto: port/account/anonymous/persistence, start/stop, loopback publish test, firewall rule per port, and a copy-paste cheat sheet of exactly what to enter in V-Net/V-Box. Writes `mosquitto.conf` + `passwd` (BOM-less UTF-8). |
| `start-nodered.bat` | Manual switch for Node-RED (console window; close = stop). Editor at `http://127.0.0.1:1880`. |
| `mediamtx.yml` | MediaMTX config template (RTMP ingest, LL-HLS output, auth) — `GANTI_*` filled by installer. |
| `config.env.example` | Template for `config.env` (Supabase URL + service key + `STREAM_NAME`). Real `config.env` is git-ignored. |
| `mqtt-bridge/` | MQTT → Supabase historian bridge (Python; Dockerfile for the Coolify/VPS variant, systemd unit for Linux). See its README. |
| `PANDUAN-RNET.md` | The operator guide (Indonesian). |

Retired (deleted; recover from git history if ever needed):
`install-services.ps1` + `cloudflared-config.yml` (NSSM/named-tunnel 24/7
mode — superseded by manual switches + the VPS relay in `deploy/vps/`),
`mqtt-bridge/mosquitto-local-test.conf` + `start-mosquitto-local.bat`
(superseded by the installer + MQTT GUI), and the four old PANDUAN files.
