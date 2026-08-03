// Reusable object storage (platform.blob) for aix-proto dynamic apps. Copy this file into your app
// and call putBlob()/getBlob()/listBlobs()/deleteBlob()/presignBlob(). It mirrors the AI and KV
// helpers: zero keys, zero per-app config, a graceful fallback, and the same shape in every
// language starter (see examples/CONTRACT.md > Object storage).
//
// WHY THIS EXISTS: the pod filesystem is EPHEMERAL and per-replica - anything you write to /tmp or
// a local dir is lost on the next deploy/restart and invisible to other replicas. platform.blob is
// durable, per-app, replica-shared S3 storage you can update at runtime WITHOUT a redeploy. Use it
// for uploaded assets (3D models, animations, video, images) and any file bigger than a KV value.
//
// The SDK gateway mediates every call; your app NEVER holds AWS credentials. Like the KV helper,
// each call RELAYS the viewer's identity (you do not build it):
//   - Base URL: $PLATFORM_GATEWAY_BASE, injected into every deployed pod. Unset (local dev with no
//     dev gateway) => blob is "not configured" and every call degrades (put/get -> undefined,
//     list -> [], presign -> undefined). Storage is an enhancement, never a hard dependency.
//   - Auth: forward the front-door-injected `x-aix-viewer-token` (from the CURRENT request) as
//     `Authorization: Bearer <token>`, plus your app's own id `x-aix-app-id: $APP_SCHEMA`. During
//     `aix-proto run`, the CLI injects a short-lived $AI_PROXY_TOKEN instead (a MyID-minted bearer);
//     when present this helper sends it as the Bearer, mirroring the AI helper.
//
// TWO TRANSPORTS:
//   - PROXY (small objects): put/get/list/delete flow app -> gateway -> S3. Simplest; use for
//     objects up to the proxy cap (a few MiB).
//   - PRESIGN (large objects, e.g. video/3D): presignBlob() asks the gateway for a short-TTL S3 URL
//     so the BROWSER (or your server) transfers the bytes DIRECT to/from S3 - they never transit
//     your app or the gateway, and the browser gets HTTP Range/streaming for free. This is the path
//     for anything large; see the browser recipe in CONTRACT.md.
//
// Fail-safe: any non-2xx, timeout, or transport error is "blob unavailable" - reads return
// undefined/[], writes return { ok: false }. Nothing here throws.

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// The gateway base, read per-call (trailing slash stripped). Lazy - like ai.js/db.js - so a
// late-set env wins and the helper stays testable.
function base() {
  return (process.env.PLATFORM_GATEWAY_BASE || '').replace(/\/$/, '');
}

// True when the platform blob store is wired for this environment ($PLATFORM_GATEWAY_BASE set).
function enabled() {
  return base() !== '';
}

// URL-encode a blob key for the path. encodeURIComponent PER SEGMENT (not encodeURI on the whole
// key): encodeURI leaves `?`, `#`, and `&` unescaped, so a legal key like "a?b.png" would be
// truncated at the query/fragment boundary. Splitting on `/` keeps the path separators literal
// (the key is a relative POSIX path) while escaping everything else inside each segment.
function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

// Boundary caps mirrored from packages/shared/src/blob.ts; clamp locally so a caller cannot trip
// the gateway's 400/413.
const PROXY_MAX_BYTES = 8 * 1024 * 1024; // proxy put cap; larger => use presignBlob()
const REQUEST_TIMEOUT_MS = 30_000;

// This app's own id, resolved like ai.js: $APP_SCHEMA (baked at build) first, else the manifest /
// package "name". Forwarded as x-aix-app-id so storage is attributed and isolated per app.
function appId() {
  return (process.env.APP_SCHEMA || readName('manifest.json') || readName('package.json') || '').trim();
}

function readName(file) {
  try {
    return JSON.parse(readFileSync(join(__dirname, file), 'utf8')).name;
  } catch {
    return undefined;
  }
}

// The relay headers: the viewer credential + this app's id. `viewerToken` is the value of the
// current request's `x-aix-viewer-token` header (deployed) - ALWAYS pass the one from the CURRENT
// request; never cache it. During `aix-proto run` the CLI's $AI_PROXY_TOKEN is used when no viewer
// token is present. Returns undefined when neither credential exists (the call would 401).
function authHeaders(viewerToken) {
  const bearer = viewerToken || process.env.AI_PROXY_TOKEN || '';
  if (!bearer) return undefined;
  return { authorization: `Bearer ${bearer}`, 'x-aix-app-id': appId() };
}

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Proxy-store one object (small, <= PROXY_MAX_BYTES). `key` is an app-relative path (e.g.
 * "assets/hero.png"); `body` is a Buffer/Uint8Array/string; `contentType` is the MIME type.
 * Returns { ok: true, object } with the stored metadata, or { ok: false } on any failure.
 */
async function putBlob(key, body, contentType, viewerToken) {
  if (!enabled()) return { ok: false };
  const headers = authHeaders(viewerToken);
  if (!headers) return { ok: false };
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.length > PROXY_MAX_BYTES) {
    // Too large for the proxy transport - the caller should presign instead. Fail soft, not throw.
    return { ok: false, reason: 'too_large_use_presign' };
  }
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(`${base()}/v1/blob/${encodeKey(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': contentType || 'application/octet-stream' },
        body: bytes,
        signal,
      });
      if (!res.ok) return { ok: false };
      return { ok: true, object: await res.json() };
    });
  } catch {
    return { ok: false };
  }
}

/** Read one object (small) via the proxy transport. Returns { body: Buffer, contentType } or
 * undefined (missing/unavailable). For large objects prefer a presigned GET (presignBlob). */
async function getBlob(key, viewerToken) {
  if (!enabled()) return undefined;
  const headers = authHeaders(viewerToken);
  if (!headers) return undefined;
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(`${base()}/v1/blob/${encodeKey(key)}`, { headers, signal });
      if (!res.ok) return undefined;
      const buf = Buffer.from(await res.arrayBuffer());
      return { body: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
    });
  } catch {
    return undefined;
  }
}

/** This app's object metadata (never bytes), or [] when unavailable. */
async function listBlobs(viewerToken) {
  if (!enabled()) return [];
  const headers = authHeaders(viewerToken);
  if (!headers) return [];
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(`${base()}/v1/blob`, { headers, signal });
      if (!res.ok) return [];
      return (await res.json()).objects || [];
    });
  } catch {
    return [];
  }
}

/** Delete one object. Returns true when it existed and was deleted, false otherwise. */
async function deleteBlob(key, viewerToken) {
  if (!enabled()) return false;
  const headers = authHeaders(viewerToken);
  if (!headers) return false;
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(`${base()}/v1/blob/${encodeKey(key)}`, { method: 'DELETE', headers, signal });
      return res.status === 204;
    });
  } catch {
    return false;
  }
}

/**
 * Mint a short-TTL presigned URL so the BROWSER (or your server) transfers a LARGE object direct
 * to/from S3 - the bytes never touch your app or the gateway. For an upload pass
 * { op: 'put', key, contentType, size }; for a download pass { op: 'get', key }. Returns the gateway's
 * presign response (a POST form for uploads: { method:'POST', url, fields, key, max_bytes, expires_at };
 * a URL for downloads: { method:'GET', url, key, expires_at }) or undefined when unavailable.
 * Typical use: your app exposes /api/assets/presign, calls this, and hands the result to the browser,
 * which POSTs the file to `url` with `fields` (upload) or uses `url` as an <img>/<video> src (download).
 */
async function presignBlob(request, viewerToken) {
  if (!enabled()) return undefined;
  const headers = authHeaders(viewerToken);
  if (!headers) return undefined;
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(`${base()}/v1/blob/presign`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!res.ok) return undefined;
      return await res.json();
    });
  } catch {
    return undefined;
  }
}

module.exports = { enabled, putBlob, getBlob, listBlobs, deleteBlob, presignBlob, PROXY_MAX_BYTES };
