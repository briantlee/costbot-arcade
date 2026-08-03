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
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

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

// Returns { url, scoped } (scoped = connected with this app's OWN role, schema pre-provisioned
// by the platform) or undefined when no DB is configured.
async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, scoped: false };
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
    url: `postgres://${encodeURIComponent(s.username)}:${encodeURIComponent(s.password)}@${host}:${port}/${db}?sslmode=require&uselibpqcompat=true`,
    scoped: Boolean(ownSecretId),
  };
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
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: resolved.url,
      // Encrypted transit without cert verification, matching the control plane (resolve-db-url.ts).
      // The URL carries `sslmode=require&uselibpqcompat=true`: pg-connection-string >=2.13.0 treats a
      // bare `sslmode=require` as `verify-full`, which would override this ssl option and reject the
      // Amazon RDS CA that Node's trust store lacks (the "self-signed certificate in certificate
      // chain" failure). `uselibpqcompat=true` keeps libpq semantics (encrypt, don't verify), so this
      // option wins. A production app that needs verify-full should pass { ca: <RDS CA bundle> } here.
      ssl: resolved.url.includes('rds.amazonaws.com') ? { rejectUnauthorized: false } : undefined,
      max: 4,
      // Every pooled connection starts with this app's schema first on the search_path, so
      // unqualified statements create in / read from the app's own schema (race-free vs. SET).
      // `schema` is a normalized [a-z][a-z0-9_]* identifier; quote it so a name that collides with a
      // reserved word (e.g. "user") still works.
      options: `-c search_path="${schema}",public`,
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

module.exports = { getPool, appSchema, appSlug, appDbSecretId, normalizeSchema };
