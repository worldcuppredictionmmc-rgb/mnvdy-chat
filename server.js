const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const clients = new Map();
const waiting = { text: [], video: [] };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/ice-config') {
    const turnUrls = (process.env.TURN_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
    const username = process.env.TURN_USERNAME || '';
    const credential = process.env.TURN_CREDENTIAL || '';
    const validTurnUrls = turnUrls.filter(url => /^turns?:/i.test(url));
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (validTurnUrls.length && username && credential) iceServers.push({ urls: validTurnUrls, username, credential });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ iceServers, turnConfigured: validTurnUrls.length > 0 && !!username && !!credential }));
    return;
  }
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

function frame(text, opcode = 1) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) { header = Buffer.from([0x80 | opcode, payload.length]); }
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}
function send(client, data) { if (client && !client.closed) client.socket.write(frame(JSON.stringify(data))); }
function dropFromQueue(client) { for (const q of Object.values(waiting)) { const i = q.indexOf(client); if (i !== -1) q.splice(i, 1); } }
function unpair(client, notify = true) {
  const peer = client.peer;
  client.peer = null;
  client.matchId = null;
  if (peer) { peer.peer = null; if (notify) send(peer, { type: 'ended' }); }
  if (peer) peer.matchId = null;
}
function match(client) {
  const q = waiting[client.mode];
  let bestIndex = -1, bestScore = -1;
  for (let i = 0; i < q.length; i++) {
    const candidate = q[i];
    if (candidate === client || candidate.closed || candidate.peer) continue;
    const score = client.interests.filter(x => candidate.interests.includes(x)).length;
    if (score > bestScore) { bestIndex = i; bestScore = score; }
  }
  if (bestIndex < 0) { if (!q.includes(client)) q.push(client); send(client, { type: 'searching' }); return; }
  const peer = q.splice(bestIndex, 1)[0];
  const matchId = crypto.randomUUID();
  client.peer = peer; peer.peer = client;
  client.matchId = matchId; peer.matchId = matchId;
  send(client, { type: 'matched', ownId: client.id, peerId: peer.id, matchId, mode: client.mode });
  send(peer, { type: 'matched', ownId: peer.id, peerId: client.id, matchId, mode: peer.mode });
}
function handle(client, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'start' || msg.type === 'next') {
    dropFromQueue(client); unpair(client);
    client.mode = msg.mode === 'video' ? 'video' : 'text';
    client.interests = Array.isArray(msg.interests) ? msg.interests.filter(x => typeof x === 'string').slice(0, 5).map(x => x.toLowerCase()) : [];
    match(client);
  } else if (msg.type === 'message' && client.peer && typeof msg.text === 'string') {
    const text = msg.text.trim().slice(0, 2000);
    if (text) send(client.peer, { type: 'message', text });
  } else if (msg.type === 'signal' && client.peer && msg.matchId === client.matchId && client.peer.matchId === client.matchId && msg.data && typeof msg.data === 'object') {
    send(client.peer, { type: 'signal', matchId: client.matchId, data: msg.data });
  } else if (msg.type === 'report' || msg.type === 'leave') {
    dropFromQueue(client); unpair(client, true);
    if (msg.type === 'report') send(client, { type: 'reported' });
  }
}
function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0], b1 = client.buffer[1], opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
    let length = b1 & 0x7f, offset = 2;
    if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (client.buffer.length < 10) return; const n = client.buffer.readBigUInt64BE(2); if (n > 65536n) return closeClient(client); length = Number(n); offset = 10; }
    if (!masked) return closeClient(client);
    if (client.buffer.length < offset + 4 + length) return;
    const mask = client.buffer.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + length)); client.buffer = client.buffer.subarray(offset + length);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    if (opcode === 8) { client.socket.end(frame('', 8)); closeClient(client); return; }
    if (opcode === 9) { client.socket.write(frame(payload, 10)); continue; }
    if (opcode !== 1 || payload.length > 8192) continue;
    try { handle(client, JSON.parse(payload.toString('utf8'))); } catch { send(client, { type: 'error', message: 'Invalid request.' }); }
  }
}
function closeClient(client) {
  if (!client || client.closed) return;
  client.closed = true; dropFromQueue(client); unpair(client); clients.delete(client.id);
  try { client.socket.destroy(); } catch {}
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url?.split('?')[0] !== '/ws' || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = { id: crypto.randomUUID(), socket, buffer: Buffer.alloc(0), closed: false, peer: null, matchId: null, mode: 'text', interests: [] };
  clients.set(client.id, client);
  socket.on('data', data => parseFrames(client, data));
  socket.on('close', () => closeClient(client)); socket.on('error', () => closeClient(client));
  send(client, { type: 'ready' });
});
server.listen(PORT, () => console.log(`mnvdy chat listening on http://localhost:${PORT}`));


