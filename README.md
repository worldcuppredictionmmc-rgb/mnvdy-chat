# mnvdy chat

A no-login random chat starter with text matching and WebRTC video signaling.

## Run locally

Requires Node.js 18 or newer. From this folder, run:

```sh
npm start
```

Then open http://localhost:3000 in two browser windows (or on two devices on the same network using the computer's local IP). Click **Find someone to chat with** in both windows. Choose the same mode in both windows. For video, allow camera and microphone access.

## Public hosting

Deploy this folder as a long-running Node service and point the domain at it. Set `PORT` if your host provides one. Serve it over HTTPS; the browser requires a secure context for camera and microphone access, and the page automatically uses secure WebSockets on HTTPS. For video connections across restrictive networks, configure a TURN service using the environment variables described below.

The current matcher keeps its queue in memory, so run one server instance. It is a starter implementation rather than a production moderation system: reports are written to the server log, and there is no persistent review queue, rate limiting, or distributed matchmaking store. Add those before opening it to large public traffic.

Video signaling is scoped to each server-generated match ID. The clients elect one offerer by peer ID, repeat a short `ready` handshake, queue early ICE candidates, and attempt an ICE restart after a failed/disconnected ICE state. This keeps video negotiation on the existing `/ws` channel without changing text chat.

### TURN for reliable video

The app always includes Google's public STUN server as a fallback. For networks where direct WebRTC cannot connect, add a TURN service from a provider and configure these environment variables on the Render **Web Service** (Dashboard → your service → Environment):

| Variable | Value |
| --- | --- |
| `TURN_URLS` | Comma-separated TURN URLs supplied by your provider, such as `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp` |
| `TURN_USERNAME` | The TURN username supplied by your provider |
| `TURN_CREDENTIAL` | The TURN password/credential supplied by your provider |

Do not use the example hostname above. Copy the actual URLs and credentials from the TURN provider. Save the variables and redeploy/restart the Render service. Both participants fetch the same ICE configuration from `/ice-config`; if TURN is not configured, the app falls back to STUN. The browser must receive TURN credentials to use TURN, so prefer provider-issued short-lived credentials when available. Never put TURN secrets in `index.html`, `call.html`, or Git.

The separate `call.html` window is opened from the Video Chat button and mirrors the active call, text messages, and Next/Report/End controls. If the browser blocks pop-ups, allow pop-ups for the site; the existing in-page chat remains available.

For a deployment smoke test, set the three `TURN_*` variables in Render, deploy, and open the site in two browsers on different networks. Allow camera and microphone on both, choose Video Chat, and confirm both remote videos appear. In browser developer tools, check for `[WebRTC] TURN configured: yes` and connected ICE/peer states. Confirm `/ice-config` contains TURN URLs but do not copy/share its response because browser clients receive the credentials. Test Next, Report, End chat, and the text mode afterward.
