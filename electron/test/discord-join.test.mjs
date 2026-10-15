import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DiscordFrameDecoder, DiscordRpcClient, buildPresenceActivity, encodeDiscordFrame, joinTarget, withoutJoin } from '../discord-rpc.mjs';
import { BenchmarkStore, sanitizeBenchmark } from '../benchmark.mjs';
import { sanitizeSettings } from '../settings.mjs';

const allow = { discordShowMap: true, privacyMode: false, discordJoin: true, discordJoinLobbies: false };
const server = { kind: 'playing', mode: 'multiplayer', mapName: 'bhop_x', room: { id: 'eu-1', lobby: false, players: 3, max: 12 } };
const lobby = { ...server, room: { id: 'p-abcdefghij', lobby: true, players: 2, max: 8 } };

test('Join defaults: public servers on, private lobbies off', () => {
  const s = sanitizeSettings();
  assert.equal(s.discordJoin, true);
  assert.equal(s.discordJoinLobbies, false);
});

test('a public server is joinable; the secret replaces the Play button', () => {
  const a = buildPresenceActivity(server, allow);
  assert.equal(a.secrets.join, 'bh1:s:eu-1');
  assert.deepEqual(a.party.size, [3, 12]);
  assert.match(a.party.id, /^[a-f0-9]{32}$/);
  assert.equal('buttons' in a, false);
  assert.equal(joinTarget(a.secrets.join), 'https://bunnyhop.lol/?server=eu-1');
});

test('private lobbies stay private unless allowed, and never show the invite code', () => {
  const hidden = buildPresenceActivity(lobby, allow);
  assert.equal('secrets' in hidden, false);
  assert.equal('party' in hidden, false);
  assert.ok(hidden.buttons);
  const shared = buildPresenceActivity(lobby, { ...allow, discordJoinLobbies: true });
  assert.equal(shared.secrets.join, 'bh1:l:abcdefghij');
  assert.equal(JSON.stringify(shared.party).includes('abcdefghij'), false);
  assert.equal(joinTarget(shared.secrets.join), 'https://bunnyhop.lol/?lobby=abcdefghij');
});

test('privacy mode, Join off, menus, replays and forged rooms share nothing', () => {
  for (const settings of [{ ...allow, privacyMode: true }, { ...allow, discordJoin: false }]) assert.equal('secrets' in buildPresenceActivity(server, settings), false);
  for (const kind of ['menu', 'replay']) assert.equal('secrets' in buildPresenceActivity({ ...server, kind }, allow), false);
  for (const id of ['../x', 'EU', 'p-abcdefghij', 'a'.repeat(40), 'https://evil.test']) assert.equal('secrets' in buildPresenceActivity({ ...server, room: { ...server.room, id } }, allow), false);
  assert.equal('secrets' in buildPresenceActivity({ ...lobby, room: { ...lobby.room, id: 'p-short' } }, { ...allow, discordJoinLobbies: true }), false);
});

test('join secrets from Discord open only game rooms', () => {
  for (const s of ['bh1:s:../admin', 'bh1:x:eu-1', 'bh1:l:ABCDEFGHIJ', 'bh1:s:p-abcdefghij', 'https://evil.test', '', null, 'bh1:s:eu-1?x=1']) assert.equal(joinTarget(s), null);
});

test('withoutJoin puts the Play button back', () => {
  const a = withoutJoin(buildPresenceActivity(server, allow));
  assert.equal('secrets' in a, false);
  assert.equal('party' in a, false);
  assert.equal(a.buttons[0].url, 'https://bunnyhop.lol');
});

class Socket extends Duplex {
  constructor() { super(); this.writes = []; }
  _read() {}
  _write(chunk, _e, cb) { this.writes.push(Buffer.from(chunk)); cb(); }
}
const frames = (socket) => socket.writes.flatMap((w) => new DiscordFrameDecoder().push(w));
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function connected(options) {
  const socket = new Socket();
  const client = new DiscordRpcClient('123456789012345678', { candidates: ['x'], connect: () => { queueMicrotask(() => socket.emit('connect')); return socket; }, ...options });
  client.on('error', () => {});
  await client.start();
  return { socket, client };
}

test('with Join on, the client subscribes after READY and turns a friend\'s Join into a room URL', async () => {
  const { socket, client } = await connected({ join: true });
  const joins = [];
  client.on('join', (t) => joins.push(t));
  socket.push(encodeDiscordFrame(1, { evt: 'READY' }));
  await flush();
  assert.ok(frames(socket).some((f) => f.payload.cmd === 'SUBSCRIBE' && f.payload.evt === 'ACTIVITY_JOIN'));
  socket.push(encodeDiscordFrame(1, { cmd: 'DISPATCH', evt: 'ACTIVITY_JOIN', data: { secret: 'bh1:s:eu-1' } }));
  socket.push(encodeDiscordFrame(1, { cmd: 'DISPATCH', evt: 'ACTIVITY_JOIN', data: { secret: 'bh1:s:../x' } }));
  await flush();
  assert.deepEqual(joins, ['https://bunnyhop.lol/?server=eu-1']);
  client.stop();
});

test('without Join the client never subscribes', async () => {
  const { socket, client } = await connected({});
  socket.push(encodeDiscordFrame(1, { evt: 'READY' }));
  await flush();
  assert.equal(frames(socket).some((f) => f.payload.cmd === 'SUBSCRIBE'), false);
  client.stop();
});

test('Discord refusing Join keeps presence alive without it', async () => {
  const { socket, client } = await connected({ join: true });
  const errors = [];
  const notices = [];
  client.removeAllListeners('error');
  client.on('error', (e) => errors.push(e));
  client.on('join-unavailable', (m) => notices.push(m));
  socket.push(encodeDiscordFrame(1, { evt: 'READY' }));
  await flush();
  client.setActivity(buildPresenceActivity(server, allow));
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  socket.push(encodeDiscordFrame(1, { cmd: 'SET_ACTIVITY', evt: 'ERROR', data: { message: 'secrets not allowed' } }));
  socket.push(encodeDiscordFrame(1, { cmd: 'SUBSCRIBE', evt: 'ERROR', data: { message: 'no' } }));
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  assert.equal(errors.length, 0);
  assert.equal(notices.length, 2);
  const last = frames(socket).filter((f) => f.payload.cmd === 'SET_ACTIVITY').at(-1).payload.args.activity;
  assert.equal('secrets' in last, false);
  assert.ok(last.buttons);
  client.stop();
});

test('benchmark results are bounded, and the store keeps the newest 20', () => {
  assert.equal(sanitizeBenchmark({ frames: 0 }), null);
  assert.equal(sanitizeBenchmark('x'), null);
  const r = sanitizeBenchmark({ map: 'bhop_x\u0000', frames: 9000, seconds: 30, interval: { avg: 3.3, p50: 3.2, p99: 6, max: 40 }, work: { p50: 1, p99: 2, max: Infinity }, hitches: 4, graphics: { width: 1920, height: 1080, fpsLimit: 1000 }, extra: 'x' }, { profile: 'balanced', display: 'DELL', refreshHz: 280 });
  assert.equal(r.map, 'bhop_x');
  assert.equal(r.work.max, null);
  assert.equal('extra' in r, false);
  assert.equal(r.launch.refreshHz, 280);
  const store = new BenchmarkStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'bh-bench-')), 'benchmarks.json'));
  for (let i = 0; i < 25; i++) store.add({ ...r, id: String(i) });
  const list = store.list();
  assert.equal(list.length, 20);
  assert.equal(list[0].id, '24');
});
