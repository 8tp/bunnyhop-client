import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;
const MAX_FRAME = 64 * 1024;
const DEFAULT_RETRY_DELAYS = Object.freeze([2_000, 5_000, 10_000, 30_000, 60_000]);

export function encodeDiscordFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length > MAX_FRAME) throw new Error('Discord RPC frame is too large');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export class DiscordFrameDecoder {
  constructor() { this.buffer = Buffer.alloc(0); }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (length > MAX_FRAME) throw new Error('Discord RPC frame exceeded the limit');
      if (this.buffer.length < 8 + length) break;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      frames.push({ op, payload: JSON.parse(body.toString('utf8')) });
    }
    return frames;
  }
}

export function discordSocketCandidates({ platform = process.platform, env = process.env, uid = os.userInfo().uid } = {}) {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_unused, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  }
  const roots = [
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    Number.isInteger(uid) ? `/run/user/${uid}` : null,
    '/tmp',
  ].filter(Boolean);
  return [...new Set(roots)].flatMap((root) => (
    Array.from({ length: 10 }, (_unused, index) => path.posix.join(root, `discord-ipc-${index}`))
  ));
}

function cleanText(value, max = 80) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export const PRESENCE_KINDS = Object.freeze(['menu', 'playing', 'paused', 'results', 'replay']);
export const PRESENCE_MODES = Object.freeze(['solo', 'multiplayer', 'practice', 'replay']);
export const BUNNYHOP_LOGO_URL = 'https://bunnyhop.lol/icons/icon-512.png';

// Only public, first-party map thumbnails may leave the renderer through RPC.
// Reject other paths, arbitrary query parameters, credentials, and local URLs.
function mapArtwork(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  if (!/^(?:https:\/\/bunnyhop\.lol)?\/thumbs\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:webp|png|jpe?g)(?:\?v=[a-fA-F0-9]{1,64})?$/.test(value)) return null;
  const url = new URL(value, 'https://bunnyhop.lol').href;
  return url.length <= 256 ? url : null;
}

const SERVER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const LOBBY_ID = /^p-[a-z2-7]{10}$/;
const JOIN_SECRET = /^bh1:(s|l):([a-z0-9-]{1,32})$/;

/* Discord Join. The room goes into the activity only when the player allows
   it: public servers with discordJoin, private lobbies only with
   discordJoinLobbies too, never in privacy mode. The secret reaches only the
   friend who presses Join; the party id everyone can see is a hash, so it
   never shows a lobby's invite code. */
export function joinableRoom(raw, settings = {}) {
  const room = raw?.room;
  if (!room || typeof room !== 'object' || settings.privacyMode || settings.discordJoin !== true) return null;
  const id = String(room.id ?? '');
  const lobby = room.lobby === true;
  if (lobby ? !LOBBY_ID.test(id) || settings.discordJoinLobbies !== true : !SERVER_ID.test(id) || LOBBY_ID.test(id)) return null;
  const max = Number.isInteger(room.max) && room.max > 0 && room.max <= 64 ? room.max : null;
  const players = Number.isInteger(room.players) ? Math.min(Math.max(room.players, 1), max ?? 64) : 1;
  return { id, lobby, players, max };
}

export function joinSecret(room) {
  return room.lobby ? `bh1:l:${room.id.slice(2)}` : `bh1:s:${room.id}`;
}

/** The game URL a Join secret opens, or null. Secrets come from Discord, so they are checked like any other link. */
export function joinTarget(secret) {
  const match = JOIN_SECRET.exec(String(secret ?? ''));
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === 'l') return /^[a-z2-7]{10}$/.test(id) ? `https://bunnyhop.lol/?lobby=${id}` : null;
  return SERVER_ID.test(id) && !LOBBY_ID.test(id) ? `https://bunnyhop.lol/?server=${id}` : null;
}

/** Renderer data fills only public map/style labels; URLs are ignored, and a room only as Discord Join allows. */
export function buildPresenceActivity(raw = {}, settings = {}) {
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  raw = record(raw) ? raw : {};
  settings = record(settings) ? settings : {};
  const kind = PRESENCE_KINDS.includes(raw.kind) ? raw.kind : 'menu';
  const mode = PRESENCE_MODES.includes(raw.mode) ? raw.mode : 'solo';
  const named = settings.discordShowMap === true && !settings.privacyMode;
  const map = named && typeof raw.mapName === 'string' ? cleanText(raw.mapName, 64) : '';
  const artwork = named && kind !== 'menu' && map ? mapArtwork(raw.mapImage) : null;
  const details = {
    menu: 'In the menu',
    playing: map ? `Hopping on ${map}` : 'Bunnyhopping',
    paused: map ? `Paused on ${map}` : 'Run paused',
    results: map ? `Finished ${map}` : 'Run complete',
    replay: map ? `Watching ${map}` : 'Watching a replay',
  }[kind];
  const modeLabel = { solo: 'Solo', multiplayer: 'Multiplayer', practice: 'Practice', replay: 'Replay' }[mode];
  const style = !settings.privacyMode && kind !== 'menu' && typeof raw.style === 'string' ? cleanText(raw.style, 40) : '';
  const state = kind === 'menu' ? 'Bunnyhop' : `${modeLabel}${style ? ` · ${style}` : ''}`;
  const room = kind === 'menu' || kind === 'replay' ? null : joinableRoom(raw, settings);
  const now = Math.floor(Date.now() / 1000);
  const startedAt = Number.isFinite(raw.startedAt) && raw.startedAt >= 946684800 && raw.startedAt <= now + 60
    ? Math.floor(raw.startedAt) : now;
  return {
    type: 0,
    details,
    state,
    assets: artwork ? {
      large_image: artwork,
      large_text: map,
      small_image: BUNNYHOP_LOGO_URL,
      small_text: 'Bunnyhop',
    } : {
      large_image: BUNNYHOP_LOGO_URL,
      large_text: 'Bunnyhop',
    },
    timestamps: { start: startedAt },
    /* Discord takes either buttons or a Join secret, not both. */
    ...(room ? {
      party: { id: crypto.createHash('sha256').update(`bunnyhop-room:${room.id}`).digest('hex').slice(0, 32), ...(room.max ? { size: [room.players, room.max] } : {}) },
      secrets: { join: joinSecret(room) },
    } : { buttons: PLAY_BUTTON }),
    instance: false,
  };
}

const PLAY_BUTTON = Object.freeze([{ label: 'Play Bunnyhop', url: 'https://bunnyhop.lol' }]);

/** The same activity without Discord Join (party and secret), with the Play button back. */
export function withoutJoin(activity) {
  if (!activity?.secrets) return activity;
  const { party: _party, secrets: _secrets, ...rest } = activity;
  return { ...rest, buttons: PLAY_BUTTON };
}

function openSocket(candidate, connect = net.createConnection, onSocket = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(candidate);
    onSocket(socket);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Discord RPC connection timed out'));
    }, 350);
    const fail = (error = new Error('Discord RPC socket closed before connecting')) => {
      clearTimeout(timeout);
      reject(error);
    };
    socket.once('error', fail);
    socket.once('close', fail);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.removeListener('error', fail);
      socket.removeListener('close', fail);
      resolve(socket);
    });
  });
}

export class DiscordRpcClient extends EventEmitter {
  constructor(applicationId, options = {}) {
    super();
    if (!/^\d{17,20}$/.test(String(applicationId))) throw new Error('Discord Application ID is invalid');
    this.applicationId = String(applicationId);
    this.connect = options.connect ?? net.createConnection;
    this.candidates = options.candidates ?? discordSocketCandidates(options);
    this.socket = null;
    this.connectingSocket = null;
    this.decoder = new DiscordFrameDecoder();
    this.ready = false;
    this.pendingActivity = null;
    this.readyTimer = null;
    this.stopped = false;
    this.socketListeners = null;
    this.activityTimer = null;
    this.lastActivityAt = -Infinity;
    this.lastActivityJson = undefined;
    this.rateLimitMs = options.rateLimitMs ?? 1_000;
    /** Ask Discord for ACTIVITY_JOIN: a friend pressed Join on this player's activity. */
    this.join = options.join === true;
    /** Discord refused an activity with a Join secret: send activities without one for this session. */
    this.joinRejected = false;
  }

  async start() {
    if (this.socket) return;
    this.stopped = false;
    let lastError = new Error('Discord desktop was not found');
    for (const candidate of this.candidates) {
      if (this.stopped) throw new Error('Discord RPC connection was stopped');
      try {
        const socket = await openSocket(candidate, this.connect, (pending) => { this.connectingSocket = pending; });
        if (this.connectingSocket === socket) this.connectingSocket = null;
        if (this.stopped) {
          socket.destroy();
          throw new Error('Discord RPC connection was stopped');
        }
        this.socket = socket;
        this.decoder = new DiscordFrameDecoder();
        this.lastActivityJson = undefined;
        this.lastActivityAt = -Infinity;
        this._attach();
        this._write(OP_HANDSHAKE, { v: 1, client_id: this.applicationId });
        this.readyTimer = setTimeout(() => {
          if (this.stopped || this.socket !== socket) return;
          const error = new Error('Discord RPC handshake timed out');
          this.emit('error', error);
          socket.destroy();
        }, 5_000);
        this.emit('status', { state: 'connecting' });
        return;
      } catch (error) {
        this.connectingSocket = null;
        if (this.stopped) throw new Error('Discord RPC connection was stopped');
        lastError = error;
      }
    }
    throw lastError;
  }

  setActivity(activity) {
    this.pendingActivity = activity;
    if (!this.ready) return;
    clearTimeout(this.activityTimer);
    this.activityTimer = null;
    if (activity === null) {
      this._sendActivity();
      return;
    }
    const delay = Math.max(0, this.lastActivityAt + this.rateLimitMs - Date.now());
    if (delay) {
      this.activityTimer = setTimeout(() => {
        this.activityTimer = null;
        this._sendActivity();
      }, delay);
    } else this._sendActivity();
  }

  _sendActivity() {
    if (!this.ready || this.stopped) return;
    const activity = this.joinRejected ? withoutJoin(this.pendingActivity) : this.pendingActivity;
    const serialized = JSON.stringify(activity);
    if (serialized === this.lastActivityJson) return;
    this.lastActivityJson = serialized;
    this.lastActivityAt = Date.now();
    this._write(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: crypto.randomUUID(),
    });
  }

  clear() { this.setActivity(null); }

  stop() {
    if (this.ready) this.clear();
    this.stopped = true;
    clearTimeout(this.activityTimer);
    this.activityTimer = null;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.connectingSocket?.destroy();
    this.connectingSocket = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this._detach(socket);
    if (socket) {
      // A named-pipe reset can arrive after stop. Keep it local to this
      // retired socket instead of turning EventEmitter's `error` into an
      // uncaught process exception after the presence owner is gone.
      socket.on('error', () => {});
      socket.destroy();
    }
  }

  _attach() {
    const socket = this.socket;
    const onData = (chunk) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        for (const frame of this.decoder.push(chunk)) this._onFrame(frame);
      } catch (error) {
        this.emit('error', error);
        socket.destroy();
      }
    };
    const onError = (error) => {
      if (!this.stopped && this.socket === socket) this.emit('error', error);
    };
    const onClose = () => {
      if (this.stopped || this.socket !== socket) return;
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
      this.socket = null;
      this.ready = false;
      this.emit('status', { state: 'disconnected' });
    };
    this.socketListeners = { socket, onData, onError, onClose };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  }

  _detach(socket) {
    const listeners = this.socketListeners;
    if (!socket || listeners?.socket !== socket) return;
    socket.removeListener('data', listeners.onData);
    socket.removeListener('error', listeners.onError);
    socket.removeListener('close', listeners.onClose);
    this.socketListeners = null;
  }

  _onFrame({ op, payload }) {
    if (op === OP_PING) {
      this._write(OP_PONG, payload);
      return;
    }
    if (op === OP_CLOSE) {
      this.emit('error', new Error(cleanText(payload?.message || 'Discord closed RPC')));
      this.socket?.end();
      return;
    }
    if (op !== OP_FRAME) return;
    if (payload?.evt === 'ERROR' && payload?.cmd === 'SUBSCRIBE') {
      // No Join on this Discord: presence still works.
      this.emit('join-unavailable', cleanText(payload?.data?.message || 'Discord refused ACTIVITY_JOIN', 160));
      return;
    }
    if (payload?.evt === 'ERROR' && payload?.cmd === 'SET_ACTIVITY' && this.pendingActivity?.secrets && !this.joinRejected) {
      this.joinRejected = true;
      this.emit('join-unavailable', cleanText(payload?.data?.message || 'Discord refused the Join secret', 160));
      this.lastActivityJson = undefined;
      this._sendActivity();
      return;
    }
    if (payload?.evt === 'ERROR') {
      this.emit('error', new Error(cleanText(payload?.data?.message || 'Discord rejected RPC activity', 160)));
      return;
    }
    if (payload?.evt === 'READY') {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
      this.ready = true;
      this.emit('status', { state: 'ready' });
      this.setActivity(this.pendingActivity);
      if (this.join) this._write(OP_FRAME, { cmd: 'SUBSCRIBE', evt: 'ACTIVITY_JOIN', args: {}, nonce: crypto.randomUUID() });
      return;
    }
    if (payload?.evt === 'ACTIVITY_JOIN' && payload?.cmd === 'DISPATCH') {
      const target = joinTarget(payload?.data?.secret);
      if (target) this.emit('join', target);
    }
  }

  _write(op, payload) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeDiscordFrame(op, payload));
  }
}

/** Keeps a presence-only local RPC session alive when Discord starts late or restarts. */
export class DiscordPresence extends EventEmitter {
  constructor(applicationId, options = {}) {
    super();
    if (!/^\d{17,20}$/.test(String(applicationId))) throw new Error('Discord Application ID is invalid');
    this.applicationId = String(applicationId);
    this.createClient = options.createClient ?? (() => new DiscordRpcClient(this.applicationId, { join: options.join === true }));
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
    this.retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
    this.client = null;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.connecting = false;
    this.running = false;
    this.pendingActivity = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this._connect();
  }

  setActivity(activity) {
    this.pendingActivity = activity;
    this.client?.setActivity(activity);
  }

  clear() { this.setActivity(null); }

  stop() {
    this.running = false;
    this.connecting = false;
    if (this.retryTimer !== null) this.cancel(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    this.client = null;
    client?.removeAllListeners();
    client?.stop();
    this.emit('status', { state: 'disabled' });
  }

  async _connect() {
    if (!this.running || this.connecting || this.client) return;
    this.connecting = true;
    this.emit('status', { state: 'connecting' });
    const client = this.createClient();
    this.client = client;
    client.on('status', (status) => {
      if (this.client !== client) return;
      if (status?.state === 'ready') this.retryAttempt = 0;
      this.emit('status', status);
      if (status?.state === 'disconnected') this._lost(client);
    });
    client.on('error', (error) => {
      if (this.client !== client) return;
      this.emit('error', error);
      this._lost(client, error);
    });
    client.on('join', (target) => {
      if (this.client === client) this.emit('join', target);
    });
    client.on('join-unavailable', (message) => {
      if (this.client === client) this.emit('join-unavailable', message);
    });
    try {
      await client.start();
      if (this.client === client) client.setActivity(this.pendingActivity);
    } catch (error) {
      if (!this.running || this.client !== client) return;
      this.emit('error', error);
      this._lost(client, error);
    } finally {
      this.connecting = false;
    }
  }

  _lost(client, error = null) {
    if (!this.running || this.client !== client) return;
    client.removeAllListeners();
    client.stop();
    this.client = null;
    if (this.retryTimer !== null) return;
    const index = Math.min(this.retryAttempt, this.retryDelays.length - 1);
    const retryInMs = Math.max(250, Number(this.retryDelays[index]) || 2_000);
    this.retryAttempt += 1;
    this.emit('status', {
      state: 'reconnecting',
      retryInMs,
      ...(error?.message ? { message: cleanText(error.message, 160) } : {}),
    });
    this.retryTimer = this.schedule(() => {
      this.retryTimer = null;
      this._connect();
    }, retryInMs);
  }
}
