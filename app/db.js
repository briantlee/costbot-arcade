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
// Credentials resolve the org-native way (AWS Secrets Manager via the pod's IRSA role, NOT Vault),
// most-scoped first:
//   1. a direct DATABASE_URL wins (local dev), else
//   2. this app's OWN credential: APP_DB_SECRET_ARN, or `$APP_DB_SECRET_PREFIX/<slug>` when the
//      shared deploy injects the prefix (the control plane provisions the secret, role, and
//      schema per app - #471), else
//   3. legacy fallback: the SHARED apps_rw credential named by RDS_SECRET_ARN, combined with
//      RDS_ENDPOINT / RDS_DATABASE (pre-#471 deploys; logs a warning - no cross-app isolation).
//
// Fail-safe: if no DB is configured or the connection fails, getPool() returns null - your app
// must fall back to memory and never crash on a missing DB. `pg` + @aws-sdk/client-secrets-manager
// are loaded lazily, so an app that never persists needn't ship them.
const { X509Certificate } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const RDS_CA_BUNDLE_PATH = '/etc/ssl/certs/aix-proto-rds-ca.pem';
const RDS_HOST_SUFFIX = '.rds.amazonaws.com';
const SUPPORTED_RDS_HOST_SUFFIX = '.us-east-1.rds.amazonaws.com';

function normalizeHostname(host) {
  return host.toLowerCase().replace(/\.$/, '');
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
    return { url: process.env.DATABASE_URL, scoped: false, source: 'direct' };
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
  const url = new URL(connectionString);
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
  const url = new URL(connectionString);
  const ssl = rdsSslOptions(connectionString, options);
  if (!ssl) return { connectionString };

  // pg lets URL TLS parameters override an explicit ssl object. Remove every case-variant so a
  // direct DATABASE_URL cannot disable verification or replace the packaged CA. Keep `host=`
  // itself: pg treats it as the effective endpoint, and rdsSslOptions pins that same hostname.
  removeTlsOverrides(url);
  return { connectionString: url.toString(), ssl };
}

// Returns a pg Pool scoped (own role + search_path) to this app's own schema, or null if no DB is
// configured/reachable. Callers fall back to memory on null.
async function getPool() {
  let resolved;
  try {
    resolved = await resolveDatabaseUrl();
  } catch (err) {
    console.error('aix-db: resolving the DB secret failed -> no persistence:', err.message);
    return null;
  }
  if (!resolved) {
    console.log('aix-db: no database configured -> in-memory only');
    return null;
  }

  const schema = appSchema();
  let connectionConfig;
  try {
    connectionConfig = postgresConnectionConfig(resolved.url, {
      source: resolved.source,
    });
  } catch (err) {
    console.error('aix-db: RDS TLS setup failed -> no persistence:', err.message);
    return null;
  }
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      ...connectionConfig,
      // RDS: trust only the packaged Amazon CA bundle and verify the endpoint hostname. Local
      // development URLs keep their existing plaintext/custom behavior.
      max: 4,
      // Every pooled connection starts with this app's schema first on the search_path, so
      // unqualified statements create in / read from the app's own schema (race-free vs. SET).
      // `schema` is a normalized [a-z][a-z0-9_]* identifier; quote it so a name that collides with a
      // reserved word (e.g. "user") still works.
      options: `-c search_path="${schema}",public`,
    });
    // pg emits 'error' on the POOL when an idle client dies (server restart, network blip, an RDS
    // failover). Without a listener Node treats it as an uncaught exception and kills the process,
    // so one transient hiccup takes the whole app down. Log and let the pool replace the client.
    pool.on('error', (err) => {
      console.error('aix-db: idle client error (pool recovers):', err.message);
    });
    // With a per-app credential the platform already created the schema (and your role could not
    // create one anyway - least privilege); only the local/legacy paths self-provision it.
    if (!resolved.scoped) {
      try {
        await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      } catch (err) {
        // The pool is already running: end it before falling back to memory, or its idle
        // connections and timers leak for the process lifetime.
        await pool.end().catch(() => {});
        throw err;
      }
    }
    console.log(`aix-db: persistent (schema "${schema}"${resolved.scoped ? ', own role' : ''})`);
    return pool;
  } catch (err) {
    console.error('aix-db: connect/init failed -> no persistence:', err.message);
    return null;
  }
}

module.exports = {
  getPool,
  appSchema,
  appSlug,
  appDbSecretId,
  normalizeSchema,
  postgresConnectionConfig,
  rdsSslOptions,
};
