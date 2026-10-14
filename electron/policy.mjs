// Trusted origins and optional rendering flags. Client identity is self-reported.
export const GAME_ORIGINS = Object.freeze(['https://bunnyhop.lol', 'https://www.bunnyhop.lol']);
export const CLIENT_NAME = 'bunnyhop-client';
export const CLIENT_HEADER = 'X-Bunnyhop-Client';
export const AUTH_NAV_ORIGINS = Object.freeze(['https://discord.com']);
const AUTH_ASSET_HOSTS = ['discord.com', '*.discord.com', '*.discordapp.com', '*.hcaptcha.com', 'hcaptcha.com', 'challenges.cloudflare.com'];

export function hostMatches(host, pattern) {
  return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern;
}

const parse = (value) => {
  try { return new URL(value); } catch { return null; }
};

export function isGameUrl(value) {
  const u = parse(value);
  return Boolean(u && !u.username && !u.password && GAME_ORIGINS.includes(u.origin));
}

export function isAllowedNavigation(value) {
  const u = parse(value);
  return Boolean(u && !u.username && !u.password && u.protocol === 'https:' && (isGameUrl(value) || AUTH_NAV_ORIGINS.includes(u.origin)));
}

export function isAllowedSubframe(value) {
  const u = parse(value);
  return Boolean(u && u.protocol === 'https:' && (isGameUrl(value) || AUTH_ASSET_HOSTS.some((p) => hostMatches(u.hostname, p))));
}

export function isSafeExternal(value) {
  const u = parse(value);
  return Boolean(u && u.protocol === 'https:' && !u.username && !u.password);
}

export function gameUrl({ url = 'https://bunnyhop.lol/', client = null } = {}) {
  if (!isGameUrl(url)) throw new Error('Untrusted game URL');
  const u = new URL(url);
  if (client) u.searchParams.set('client', String(client).slice(0, 32));
  return u.toString();
}

/* Chromium switches for a launch. The game paces its own frames: Settings →
   Graphics → Exceed monitor FPS and the low-latency canvas draw past the
   refresh rate with GPU back-pressure (frame-loop.ts in the game). `uncap`
   lifts the limit for the whole browser instead, page, HUD and compositor
   included, with nothing holding frames back, so it stays an experiment and
   no profile turns it on. */
export function buildFlags({ uncap = false, preferDiscreteGpu = false, gpuBackend = 'auto', pinDeviceScale = false } = {}) {
  const flags = [];
  if (uncap) flags.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  // Laptops with two GPUs otherwise may run the game on the integrated one.
  if (preferDiscreteGpu) flags.push('--force_high_performance_gpu');
  const backend = { d3d11: 'd3d11', vulkan: 'vulkan', opengl: 'gl' }[gpuBackend];
  if (backend) flags.push(`--use-angle=${backend}`);
  if (pinDeviceScale) flags.push('--force-device-scale-factor=1');
  return flags;
}
