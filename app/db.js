// Reusable persistence for aix-proto dynamic apps. Copy this file into your app and call getPool().
//
// Zero Terraform. The platform provisions ONE shared `apps` database, and - per app - a DEDICATED
// Postgres role + schema (#471, ADR-0004): your credential can only touch YOUR schema, so many
// apps coexist with no table-name collisions AND no cross-app reads - you write unqualified
// `CREATE TABLE foo` and it lands in your schema; another app's schema is a hard permission
// denied. The schema name is baked into the image at BUILD time as APP_SCHEMA=<slug>
// (scripts/build-app.sh --build-arg APP_SCHEMA), NOT injected by the deploy pipeline (one shared
// values file for all apps) or the skill. APP_SCHEMA takes precedence; Node also falls back to the
// manifest.json / package.json "name" for a local build run without that arg.
//
// Controller-provided DATABASE_URL uses this workload's own Kubernetes Secret.
// AIX_DB_DELIVERY=tenant-v1 skips schema creation and fails closed on persistence errors.
// Credentials resolve the org-native way (AWS Secrets Manager via the pod's IRSA role, NOT Vault),
// most-scoped first:
//   1. a direct DATABASE_URL wins (local dev), else
//   2. this app's OWN credential: APP_DB_SECRET_ARN, or `$APP_DB_SECRET_PREFIX/<slug>` when the
//      shared deploy injects the prefix (the control plane provisions the secret, role, and
//      schema per app - #471), else
//   3. legacy fallback: the SHARED apps_rw credential named by RDS_SECRET_ARN, combined with
//      RDS_ENDPOINT / RDS_DATABASE (pre-#471 deploys; logs a warning - no cross-app isolation).
//
// If no DB is configured, connection fails, or beforeSchemaInit refuses the store, getPool()
// rejects in tenant mode and returns null otherwise. Apps requiring persistent authority must
// remain unavailable; only explicitly memory-capable apps may use a memory store. Dependencies
// are lazy for apps without persistence.
const { X509Certificate } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const RDS_CA_BUNDLE_PATH = '/etc/ssl/certs/aix-proto-rds-ca.pem';
const RDS_HOST_SUFFIX = '.rds.amazonaws.com';
const SUPPORTED_RDS_HOST_SUFFIX = '.us-east-1.rds.amazonaws.com';

// Separate bounds, not a request/transaction budget. Acquisition/connect gets 2s; PostgreSQL
// defaults each statement to 8s. The local response ceiling adds 250ms for a server cancellation
// reply to arrive before quarantining the transport. It covers time queued in THIS client too.
// A sequence of queries/rollback can exceed the front door/hook budget. Node timers require a
// progressing event loop; closing a socket does not prove remote cancellation or noncommit.
const POOL_MAX = 4;
const CONNECTION_TIMEOUT_MS = 2000;
const STATEMENT_TIMEOUT_MS = 8000;
const RESPONSE_TIMEOUT_MS = 8250;
const RESPONSE_TIMEOUT_CODE = 'AIX_DB_RESPONSE_TIMEOUT';

class DatabaseResponseTimeout extends Error {
  constructor(timeoutMillis) {
    super('Database response deadline exceeded; the result could not be confirmed');
    this.name = 'DatabaseResponseTimeout';
    this.code = RESPONSE_TIMEOUT_CODE;
    this.timeoutMillis = timeoutMillis;
  }
}

function isResponseTimeout(err) {
  return Boolean(err && err.code === RESPONSE_TIMEOUT_CODE);
}

function responseBudget(...values) {
  return Math.min(RESPONSE_TIMEOUT_MS, ...values.map(Number).filter((n) => Number.isFinite(n) && n > 0));
}

// Lazy and injected: no pg globals change, and memory-only apps never load the driver. Pass the
// resulting class as Pool's Client option, BEFORE any connect listener can enqueue a SET, or use
// it for a standalone LISTEN client. Own only timers/settlement, never pg's active query or queue.
// Supports the string/values/config (including callback, rowMode and prepared statement) forms
// used by the apps. Custom submit/streaming Query objects need their own terminal-event contract.
function createBoundedClient(Client) {
  if (!Client) {
    // A fake Pool may accept the constructor without ever instantiating it. Keep that seam and
    // memory fallback dependency-free; the real driver is resolved only when a client is needed.
    return function LazyBoundedClient(config) {
      const Bound = createBoundedClient(require('pg').Client);
      return new Bound(config);
    };
  }
  return class BoundedClient extends Client {
    #pending = new Set();
    #connecting = new Set();
    #failure;
    #budget;
    #readTimeout;
    #Promise;

    constructor(config) {
      super(config);
      this.#budget = responseBudget(config?.query_timeout, this.connectionParameters.query_timeout);
      this.#Promise = config?.Promise || Promise;
      this.#readTimeout = this.connectionParameters.query_timeout;
      // pg's query_timeout rejects without destroying an active transport. Replace this instance's
      // resolved timer (URL values included) with our own, retaining any supported shorter bound.
      this.connectionParameters.query_timeout = 0;
    }

    get responseTimeoutError() { return this.#failure; }

    connect(callback) {
      const connecting = this.#connecting;
      const open = (done) => {
        const attempt = {};
        connecting.add(attempt);
        try {
          return super.connect(function (...args) {
            connecting.delete(attempt);
            done.apply(this, args);
          });
        } catch (err) {
          connecting.delete(attempt);
          throw err;
        }
      };
      return callback ? open(callback) : new this.#Promise((resolve, reject) => {
        open((err) => err ? reject(err) : resolve(this));
      });
    }

    end(callback) {
      // pg gracefully sends Terminate when idle, but then waits for the peer's FIN. A query
      // already answered with ErrorResponse has no timer left to bound that wait. Give normal
      // close the existing client budget, then destroy locally; never expire an idle subscription.
      const close = (done) => {
        const timer = setTimeout(() => this.connection.stream.destroy(), this.#budget);
        // The socket, not this fallback, owns process liveness. A referenced socket keeps the
        // deadline runnable; public ref/unref (including allowExitOnIdle) must retain control.
        timer.unref();
        try {
          const result = super.end(function (...args) {
            clearTimeout(timer);
            done.apply(this, args);
          });
          // pg suppresses its connect callback on an intentional end. An error on the still
          // connecting transport settles that callback/Promise via pg's normal error handler.
          if (this.#connecting.size) this.connection.stream.destroy(new Error('Connection terminated'));
          return result;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      };
      return callback ? close(callback) : new this.#Promise((resolve) => close(resolve));
    }

    #expire(milliseconds) {
      if (this.#failure) return;
      this.#failure = new DatabaseResponseTimeout(milliseconds);
      // Quarantine and shutdown BEFORE any timeout callback runs (it may release/reborrow).
      // Client.end destroys an active query, but can gracefully wait when only queued work remains
      // after an ErrorResponse. Destroy the transport too so that case cannot await a peer's FIN.
      this.end(() => {});
      this.connection.stream.destroy();
      for (const finish of [...this.#pending]) {
        try {
          finish(this.#failure);
        } catch (err) {
          // A caller's callback must remain observable as an exception, but cannot prevent
          // other queued operations receiving their timeout. Match pg's deferred throw on
          // successful callback delivery without changing callback receivers or query queues.
          process.nextTick(() => { throw err; });
        }
      }
    }

    query(config, values, callback) {
      if (config == null) throw new TypeError('Client was passed a null or undefined query');
      if (typeof config.submit === 'function') {
        throw new TypeError('Bounded clients require a query string or config, not a streaming Query object');
      }
      const source = typeof config === 'string' ? { text: config } : config;
      // Forward only supported fields, with the original getter receiver and argument precedence.
      // Let pg's Query choose/read the callback and bind its domain itself: conditional getter
      // reads (including those after rowMode) can select a different callback or throw.
      const normalized = {
        get text() { return source.text; },
        get values() { return values && typeof values !== 'function' ? values : source.values; },
        get rows() { return source.rows; },
        get types() { return source.types; },
        get name() { return source.name; },
        get queryMode() { return source.queryMode; },
        get binary() { return source.binary; },
        get portal() { return source.portal; },
        get callback() { return callback || (typeof values === 'function' ? values : source.callback); },
        get rowMode() { return source.rowMode; },
      };
      // pg exposes its own Query constructor. Injected driver-free clients retain their plain
      // config seam; externally supplied submit/streaming objects remain unsupported above.
      const query = Client.Query ? new Client.Query(normalized)
        : Object.fromEntries(Object.keys(normalized).map((key) => [key, normalized[key]]));
      const cb = query.callback;
      if (cb && typeof cb !== 'function') throw new TypeError('callback is not a function');
      const queryTimeout = config.query_timeout;
      const milliseconds = responseBudget(this.#budget, queryTimeout);
      // Preserve pg's original wrapper intent (a per-query zero falls back to the constructor).
      // This only controls callback forwarding; the destructive local deadline remains ours.
      const readTimeout = queryTimeout || this.#readTimeout;
      // Disable pg's per-query timer too: it must never deliver an earlier, non-destructive timeout.
      query.query_timeout = 0;
      let resolve;
      let reject;
      const result = cb ? undefined : new this.#Promise((yes, no) => { resolve = yes; reject = no; }).catch((err) => {
        // Match pg's returned Promise chain, including species and the application await stack.
        Error.captureStackTrace(err);
        throw err;
      });
      let timer;
      let settled = false;
      const pending = this.#pending;
      const finish = function (...args) {
        const [err, value] = args;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(finish);
        if (cb) {
          // pg's read-timeout wrapper calls without a receiver and always forwards two args.
          // Otherwise retain Query's receiver and actual arity (one arg for ordinary SQL errors).
          if (readTimeout) cb(err, value);
          else cb.apply(this, args);
        } else if (err) reject(err);
        else resolve(value);
      };
      if (this.#failure) {
        process.nextTick(() => finish(this.#failure));
        return result;
      }
      pending.add(finish);
      timer = setTimeout(() => this.#expire(milliseconds), milliseconds);
      query.callback = finish;
      try {
        super.query(query);
      } catch (err) {
        clearTimeout(timer);
        pending.delete(finish);
        throw err;
      }
      return result;
    }
  };
}

function normalizeHostname(host) {
  return host.toLowerCase().replace(/\.$/, '');
}

// pg-connection-string repairs spaces/malformed percent escapes BEFORE parsing a URL. Do that
// before composing startup options too, or pg's later whole-string encodeURI would double-encode
// the '=' in our options. These anchored character/token checks mirror that driver's repair,
// including its decimal-only escape restoration; URL remains the parser. Keep this dependency
// free so TLS/schema validation and injected strict-pool tests do not require an installed pg.
const HEX_DIGIT = /^[a-f0-9]$/i;
const DECIMAL_PAIR = /^[0-9]{2}$/;
function parsePostgresUrl(connectionString) {
  const malformed = connectionString.split('').some((character, index) =>
    character === '%' && (
      (index + 1 < connectionString.length && !HEX_DIGIT.test(connectionString[index + 1])) ||
      (index + 2 < connectionString.length && !HEX_DIGIT.test(connectionString[index + 2]))
    ),
  );
  if (!connectionString.includes(' ') && !malformed) return new URL(connectionString);
  const repaired = encodeURI(connectionString).split('%25').map((part, index) =>
    `${index === 0 ? '' : DECIMAL_PAIR.test(part.slice(0, 2)) ? '%' : '%25'}${part}`,
  ).join('');
  return new URL(repaired);
}

function readValidatedCaBundle(caBundlePath) {
  try {
    const ca = readFileSync(caBundlePath, 'utf8');
    const certificates =
      ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    const remainder = ca.replace(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
      '',
    );
    if (certificates.length === 0 || remainder.trim() !== '') {
      throw new Error('bundle is not a PEM certificate sequence');
    }
    certificates.forEach((certificate) => {
      new X509Certificate(certificate);
    });
    return ca;
  } catch (cause) {
    throw new Error(`RDS CA bundle is missing or invalid at ${caBundlePath}`, { cause });
  }
}

function effectiveHostValue(url) {
  const hostOverrides = url.searchParams.getAll('host');
  // pg-connection-string assigns query entries in order, so a repeated `host=` is
  // last-value-wins and percent-decodes the authority hostname. Match that exact parser contract
  // before deciding whether TLS is mandatory.
  return hostOverrides.at(-1) || decodeURIComponent(url.hostname);
}

function effectiveHostnames(url) {
  return effectiveHostValue(url)
    .split(',')
    .map((host) => normalizeHostname(host.trim()));
}

function removeTlsOverrides(url) {
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('ssl') || normalized === 'uselibpqcompat') {
      url.searchParams.delete(key);
    }
  }
}
// Normalize a raw name to a safe SQL identifier: lowercase; non-[a-z0-9_] -> _; strip leading
// non-letters; cap 48; fall back to "app" when nothing remains. Pure + exported so it is testable
// in isolation (app.test.js), mirroring the Go/Python/Rust starters.
function normalizeSchema(raw) {
  const norm = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 48);
  return norm || 'app';
}

// The Postgres startup `options` for every pooled connection: this app's schema first on the
// search_path, then the server-side bound above. Startup options become the SESSION DEFAULTS
// (pg_settings.source = 'client'), so they survive RESET / RESET ALL and are already in force for
// the first statement - no post-connect SET, nothing to race. `schema` must be exactly what
// normalizeSchema produces; it is quoted so a name that collides with a reserved word (e.g. "user")
// still works. Pure + exported so the pin and the bound are testable without a database.
//
// The guard below is deliberate, not belt-and-braces: the startup `options` value is split on
// whitespace and unescaped by the server, so a schema carrying a space, a quote or a backslash
// could close the search_path pin early and smuggle in further `-c name=value` settings (a
// startup-parameter injection). getPool() only ever passes appSchema(), which is normalized, but
// this helper is exported and copied into every app, so it refuses anything else itself rather
// than trusting its caller. Anchored to normalizeSchema's exact output space: a lowercase ASCII
// letter, then up to 47 of [a-z0-9_] (48 chars total).
const NORMALIZED_SCHEMA = /^[a-z][a-z0-9_]{0,47}$/;

function poolSessionOptions(schema) {
  if (typeof schema !== 'string' || !NORMALIZED_SCHEMA.test(schema)) {
    throw new TypeError(
      `poolSessionOptions: schema must be a normalizeSchema() identifier, got ${JSON.stringify(schema)}`,
    );
  }
  return `-c search_path="${schema}",public -c statement_timeout=${STATEMENT_TIMEOUT_MS}`;
}

// PostgreSQL pg_split_opts (src/backend/utils/init/postinit.c): ASCII whitespace separates
// tokens, backslash escapes the next character, quotes are literal, a final escape is dropped.
// Retain source offsets so inserting defaults never rewrites a caller's escaped setting values.
const POSTGRES_OPTION_SPACE = ' \t\n\r\v\f';
function startupOptionTokens(options) {
  const tokens = [];
  let position = 0;
  while (position < options.length) {
    if (POSTGRES_OPTION_SPACE.includes(options[position])) {
      position += 1;
      continue;
    }
    const start = position;
    let value = '';
    while (position < options.length && !POSTGRES_OPTION_SPACE.includes(options[position])) {
      if (options[position] === '\\') position += 1;
      if (position < options.length) value += options[position++];
    }
    tokens.push({ start, value });
  }
  return tokens;
}

// The argument-taking switches from process_postgres_switches' getopt specification
// (src/backend/tcop/postgres.c). Includes '-' for --name=value and ignored startup switches:
// e.g. -C -- consumes '--' as its argument; -bC -- does too. Only a terminal delimiter that
// getopt encounters as an OPTION needs defaults inserted before it. Leave invalid nonterminal
// delimiters to PostgreSQL, and never remove '--' from a value or an option argument.
const POSTGRES_OPTIONS_WITH_ARGUMENT = 'BCcDdfhkNprStvW-';
function terminalOptionDelimiter(options) {
  const tokens = startupOptionTokens(options);
  let needsArgument = false;
  for (const [index, { start, value }] of tokens.entries()) {
    if (needsArgument) {
      needsArgument = false;
      continue;
    }
    if (value === '--') return index === tokens.length - 1 ? start : undefined;
    if (!value.startsWith('-') || value.length === 1) return undefined;
    for (let character = 1; character < value.length; character += 1) {
      if (POSTGRES_OPTIONS_WITH_ARGUMENT.includes(value[character])) {
        needsArgument = character === value.length - 1;
        break;
      }
    }
  }
  return undefined;
}

function boundedStartupOptions(url, schema) {
  // Match pg-connection-string: decoded, case-sensitive names; the LAST options parameter wins.
  const supplied = url.searchParams.getAll('options').at(-1) || '';
  if (supplied.includes('\0')) throw new TypeError('Database startup options cannot contain NUL');
  const defaults = poolSessionOptions(schema);
  const delimiter = terminalOptionDelimiter(supplied);
  if (delimiter !== undefined) {
    return `${supplied.slice(0, delimiter)}${defaults} ${supplied.slice(delimiter)}`;
  }
  // PostgreSQL's pg_split_opts splits on unescaped whitespace, treats quotes literally, and
  // drops an unmatched final backslash. Preserve that grammar verbatim. Remove only that final
  // escape before appending a delimiter, or it would escape the delimiter and swallow our -c.
  let end = supplied.length;
  while (end > 0 && supplied[end - 1] === '\\') end -= 1;
  const prefix = (supplied.length - end) % 2 === 1 ? supplied.slice(0, -1) : supplied;
  return `${prefix} ${defaults}`;
}

// This app's schema, normalized. Priority: APP_SCHEMA env (baked by the build) -> manifest.json
// "name" -> package.json "name" -> "app".
function appSchema() {
  return normalizeSchema(appSlug() || 'app');
}

// The RAW slug (same sources as appSchema, UNNORMALIZED) - the key of this app's own credential
// secret (`$APP_DB_SECRET_PREFIX/<slug>`), matching how ai.js keys the x-aix-app-id principal.
function appSlug() {
  return process.env.APP_SCHEMA || readName('manifest.json') || readName('package.json') || '';
}

function readName(file) {
  try {
    const j = JSON.parse(readFileSync(join(__dirname, file), 'utf8'));
    return typeof j.name === 'string' ? j.name : undefined;
  } catch {
    return undefined;
  }
}

// This app's own credential secret id, or undefined when the deploy predates per-app secrets:
// an explicit APP_DB_SECRET_ARN wins, else `$APP_DB_SECRET_PREFIX/<slug>` (Secrets Manager
// accepts a name as SecretId). Both env vars come from the shared deploy values; the slug half
// is this image's own APP_SCHEMA, so the derived name is this app's - not a neighbor's.
function appDbSecretId() {
  if (process.env.APP_DB_SECRET_ARN) return process.env.APP_DB_SECRET_ARN;
  const prefix = process.env.APP_DB_SECRET_PREFIX;
  const slug = appSlug();
  return prefix && slug ? `${prefix}/${slug}` : undefined;
}

// Returns { url, scoped, source } (scoped = connected with this app's OWN role, schema
// pre-provisioned by the platform; source preserves whether the URL came from a trusted RDS
// secret) or undefined when no DB is configured.
async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, scoped: process.env.AIX_DB_DELIVERY === 'tenant-v1', source: 'direct' };
  }
  const ownSecretId = appDbSecretId();
  const secretId = ownSecretId || process.env.RDS_SECRET_ARN;
  if (!secretId) return undefined;
  if (!ownSecretId) {
    console.warn('aix-db: using the SHARED apps_rw credential (pre-#471 deploy) - no cross-app isolation');
  }
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  let res;
  try {
    res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  } catch (err) {
    // DELIBERATELY no fallback to the shared RDS_SECRET_ARN here: silently reconnecting as the
    // shared role would undo the per-app isolation (#471). Loud degrade instead - rollout order
    // is "provision per-app secrets BEFORE setting APP_DB_SECRET_PREFIX on pods" (CONTRACT.md).
    if (ownSecretId) {
      console.warn(
        `aix-db: per-app secret "${ownSecretId}" not readable (${err.name}) - NOT falling back to the shared credential; running in-memory until it is provisioned`,
      );
    }
    throw err;
  }
  if (!res.SecretString) throw new Error('RDS secret has no string value');
  const s = JSON.parse(res.SecretString); // { username, password, host, port, dbname }
  const host = process.env.RDS_ENDPOINT || s.host;
  const port = String(s.port || 5432);
  const db = process.env.RDS_DATABASE || s.dbname;
  // Validate the resolved fields (the control plane validates with zod) - otherwise a missing
  // field becomes the literal "undefined" in the URL and surfaces as a confusing connect error.
  if (!s.username || !s.password || !host || !db) {
    throw new Error('RDS secret/env is missing a required DB field (username, password, host, dbname)');
  }
  // Both username and password are URL-encoded: an RDS credential can contain : / @ etc.
  return {
    url: `postgres://${encodeURIComponent(s.username)}:${encodeURIComponent(s.password)}@${host}:${port}/${db}`,
    scoped: Boolean(ownSecretId),
    source: 'rds-secret',
  };
}

function rdsSslOptions(connectionString, options = {}) {
  const { source = 'direct', caBundlePath = RDS_CA_BUNDLE_PATH } = options;
  const url = parsePostgresUrl(connectionString);
  const hosts = effectiveHostnames(url);
  const rdsHosts = hosts.filter((host) => host.endsWith(RDS_HOST_SUFFIX));
  if (rdsHosts.length > 0 && rdsHosts.length !== hosts.length) {
    throw new Error(
      'RDS TLS cannot safely mix RDS and non-RDS endpoints in one database URL',
    );
  }
  if (source !== 'rds-secret' && rdsHosts.length === 0) return undefined;
  if (hosts.some((host) => host === '')) {
    throw new Error('Secret-derived database URL has no hostname');
  }
  const unsupportedHost = rdsHosts.find(
    (host) => !host.endsWith(SUPPORTED_RDS_HOST_SUFFIX),
  );
  if (unsupportedHost) {
    throw new Error(
      `RDS TLS is configured only for us-east-1; unsupported endpoint hostname: ${unsupportedHost}`,
    );
  }
  // node-postgres exposes one static TLS `servername`; it cannot bind hostname verification to
  // each endpoint in a failover list. Reject lists that require pinned TLS instead of silently
  // disabling verification or pinning only the first host.
  if (hosts.length !== 1) {
    throw new Error(
      'Verified Node PostgreSQL connections require one effective hostname; multi-host database URLs are unsupported',
    );
  }
  return {
    ca: readValidatedCaBundle(caBundlePath),
    rejectUnauthorized: true,
    servername: hosts[0],
  };
}

function postgresConnectionConfig(connectionString, options = {}) {
  // The original strict-TLS path normalized URL spaces before pg parsed credentials.
  // Preserve that order: pg's raw-string repair double-encodes valid hex-letter escapes.
  // Non-RDS URLs retain the driver's raw-input semantics, including malformed-percent repair.
  const normalized = new URL(connectionString).toString();
  const ssl = rdsSslOptions(normalized, options);
  const url = parsePostgresUrl(ssl ? normalized : connectionString);
  // pg decodes the database pathname after its initial percent repair. Validate at that same
  // boundary BEFORE adding options: a trailing incomplete escape would otherwise meet our new
  // '?' delimiter and trigger a second whole-string repair of credentials and startup defaults.
  decodeURI(url.pathname);
  if (options.schema !== undefined) {
    // Keep benign URL settings, then apply our session defaults LAST, inside the URL itself:
    // node-postgres merges URL options OVER an explicit Pool.options string. Startup defaults
    // protect the first query and RESET ALL without a post-connect SET race.
    url.searchParams.set('options', boundedStartupOptions(url, options.schema));
    // pg sends this as a separate startup field, which PostgreSQL applies AFTER options.
    // Remove all decoded occurrences so it cannot undo the statement bound above.
    url.searchParams.delete('statement_timeout');
  }
  if (!ssl) return { connectionString: options.schema === undefined ? connectionString : url.toString() };

  // pg lets URL TLS parameters override an explicit ssl object. Remove every case-variant so a
  // direct DATABASE_URL cannot disable verification or replace the packaged CA. Keep `host=`
  // itself: pg treats it as the effective endpoint, and rdsSslOptions pins that same hostname.
  removeTlsOverrides(url);
  return { connectionString: url.toString(), ssl };
}

// Returns a pg Pool scoped (own role + search_path) to this app's own schema. Unavailable DBs
// reject in tenant mode; otherwise return null. Callers requiring persistence must refuse null.
// beforeSchemaInit may inspect metadata and refuse an incompatible store before any schema DDL.
// It runs for both provisioned and local schemas and must not inspect or mutate legacy row data.
async function getPool({ beforeSchemaInit } = {}) {
  if (beforeSchemaInit !== undefined && typeof beforeSchemaInit !== 'function') {
    // A value-free programming-error diagnostic: never the callback, never an outage message.
    if (process.env.AIX_DB_DELIVERY === 'tenant-v1') throw new Error('aix-db: invalid database preflight');
    console.error('aix-db: invalid database preflight -> no persistence');
    return null;
  }
  let resolved;
  try {
    resolved = await resolveDatabaseUrl();
  } catch (err) {
    if (process.env.AIX_DB_DELIVERY === 'tenant-v1') throw new Error('aix-db: tenant database unavailable');
    console.error('aix-db: resolving the DB secret failed -> no persistence:', err.message);
    return null;
  }
  if (!resolved) {
    if (process.env.AIX_DB_DELIVERY === 'tenant-v1') throw new Error('aix-db: tenant database unavailable');
    console.log('aix-db: no database configured -> in-memory only');
    return null;
  }

  const schema = appSchema();
  let connectionConfig;
  try {
    connectionConfig = postgresConnectionConfig(resolved.url, {
      source: resolved.source,
      schema,
    });
  } catch (err) {
    if (process.env.AIX_DB_DELIVERY === 'tenant-v1') throw new Error('aix-db: tenant database unavailable');
    console.error('aix-db: connection setup failed -> no persistence:', err.message);
    return null;
  }
  try {
    const { Pool, Client } = require('pg');
    const pool = new Pool({
      Client: createBoundedClient(Client),
      // RDS: trust only the packaged Amazon CA bundle and verify the endpoint hostname. Local
      // development URLs keep their existing plaintext/custom behavior.
      ...connectionConfig,
      max: POOL_MAX,
      // A checkout that finds all POOL_MAX connections busy - or a connect to an endpoint that
      // never answers - rejects with pg-pool's 'timeout exceeded when trying to connect' /
      // 'Connection terminated due to connection timeout' instead of waiting forever.
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    // pg emits 'error' on the POOL when an idle client dies (server restart, network blip, an RDS
    // failover). Without a listener Node treats it as an uncaught exception and kills the process,
    // so one transient hiccup takes the whole app down. Log and let the pool replace the client.
    pool.on('error', (err) => {
      console.error('aix-db: idle client error (pool recovers):', err.message);
    });
    try {
      if (beforeSchemaInit) {
        try {
          await beforeSchemaInit(pool, schema);
        } catch {
          // A refusal must not leak caller-supplied database metadata or exception contents.
          throw new Error('Database preflight refused');
        }
      }
      // With a per-app credential the platform already created the schema (and your role could
      // not create one anyway); only the local/legacy paths self-provision it after preflight.
      if (!resolved.scoped) {
        await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      }
    } catch (err) {
      // The pool is already running: refusal must close its connections and timers.
      await pool.end().catch(() => {});
      throw err;
    }
    if (process.env.AIX_DB_DELIVERY === 'tenant-v1') {
      try { await pool.query('SELECT 1'); }
      catch { await pool.end().catch(() => {}); throw new Error('aix-db: tenant database unavailable'); }
    }
    console.log(`aix-db: persistent (schema "${schema}"${resolved.scoped ? ', own role' : ''})`);
    return pool;
  } catch (err) {
    if (process.env.AIX_DB_DELIVERY === 'tenant-v1') throw new Error('aix-db: tenant database unavailable');
    console.error('aix-db: connect/init failed -> no persistence:', err.message);
    return null;
  }
}

module.exports = {
  createBoundedClient,
  DatabaseResponseTimeout,
  isResponseTimeout,
  getPool,
  appSchema,
  appSlug,
  appDbSecretId,
  normalizeSchema,
  poolSessionOptions,
  postgresConnectionConfig,
  rdsSslOptions,
  // The bounds, for an app that wants to size its own deadlines against them.
  poolBounds: Object.freeze({
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statementTimeoutMillis: STATEMENT_TIMEOUT_MS,
    responseTimeoutMillis: RESPONSE_TIMEOUT_MS,
  }),
};
