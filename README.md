# mnvdy chat

A no-login random chat starter with text matching and WebRTC video signaling.

## Run locally

Requires Node.js 18 or newer. From this folder, run:

```sh
npm start
```

Then open http://localhost:3000 in two browser windows (or on two devices on the same network using the computer's local IP). Click **Find someone to chat with** in both windows. Choose the same mode in both windows. For video, allow camera and microphone access.

## Public hosting

Deploy this folder as a long-running Node service and point the domain at it. Set `PORT` if your host provides one. Serve it over HTTPS; the browser requires a secure context for camera and microphone access, and the page automatically uses secure WebSockets on HTTPS. For video connections across restrictive networks, configure a TURN service and add its credentials to the `iceServers` list in `index.html`.

The current matcher keeps its queue in memory, so run one server instance. It is a starter implementation rather than a production moderation system: reports are written to the server log, and there is no persistent review queue, rate limiting, or distributed matchmaking store. Add those before opening it to large public traffic.
