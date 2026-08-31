# Dynamic-tier app image. Built by Norfolk CI (build.yaml), NOT locally. Build context is the
# repo root (same as packages/api + the other examples/), so COPY paths are repo-root-relative.
# On copy to examples/<your-slug>/, replace `_template` below with `<your-slug>` (the /aix-proto
# skill does this automatically). Serves on 3000 with /health_check.
# Pin the tag (not floating `24-alpine`) for reproducible builds; bump deliberately.
#
# TWO STAGES so the app's tests run but never ship. `test` installs deps, copies the source AND the
# *.test.js files, and runs them; the runtime stage below copies node_modules from it and the source
# from the build context, so no layer of the pushed image ever contains a test file. A single-stage
# "COPY tests, run, then rm" does NOT achieve this: the rm only writes whiteout markers into a later
# layer, and the COPY layer's blob still ships the test source to every puller (recoverable with
# `docker save`). Mirrors the go/rust/java starters, which were already multi-stage.
FROM artifactory.global.twdcgrid.net/hulu-docker/node:24.16-alpine AS test
WORKDIR /app
COPY certs/aws-rds/us-east-1-bundle.pem /etc/ssl/certs/aix-proto-rds-ca.pem
COPY .npmrc examples/costbot-arcade/package.json examples/costbot-arcade/package-lock.json ./
RUN npm ci --omit=dev --no-fund
# This app uses no AI, so ai.js / ai.test.js were removed from the template — they are
# deliberately absent from these COPY lines too (a stale path fails the image build).
COPY examples/costbot-arcade/server.js examples/costbot-arcade/db.js examples/costbot-arcade/manifest.json ./
# Run the app's own DB-free unit tests and FAIL THE IMAGE BUILD on a red test - the same guarantee
# _template-java has always had via `mvn package`. This is the only place an app's tests execute:
# CI's per-language matrix covers examples/costbot-arcade* only, and the root Vitest suite scopes to
# packages/** + scripts/**, so without this a Node app with a failing test builds and deploys green.
# `node --test` is the built-in runner, so `npm ci --omit=dev` stays untouched (no devDependency).
# Deleting the tests? Drop this COPY + RUN too, or the build fails on a missing file.
COPY examples/costbot-arcade/app.test.js ./
RUN node --test

FROM artifactory.global.twdcgrid.net/hulu-docker/node:24.16-alpine

WORKDIR /app
COPY certs/aws-rds/us-east-1-bundle.pem /etc/ssl/certs/aix-proto-rds-ca.pem
# package.json + the lockfile still ship (node resolves "main"/deps from them at runtime); .npmrc is
# build-only and deliberately NOT copied here.
COPY examples/costbot-arcade/package.json examples/costbot-arcade/package-lock.json ./
COPY examples/costbot-arcade/server.js examples/costbot-arcade/db.js examples/costbot-arcade/manifest.json ./
# The arcade itself — landing page, Waste Hunter, Jukebox and the shared modules. server.js
# serves this tree, so without it the image starts fine and then 404s every page.
COPY examples/costbot-arcade/public ./public

# Reuse the EXACT tree the tests ran against instead of a second `npm ci` - one reproducible install
# (#481: the committed lockfile pins direct + transitive deps), half the build time, and no chance of
# the runtime deps differing from the tested ones. This --from reference is also what KEEPS the gate
# live: BuildKit prunes unreferenced stages, so without it the test stage could be skipped entirely.
COPY --from=test /app/node_modules ./node_modules

# Strip the base image's bundled npm/corepack: unused at runtime (CMD runs node directly), and the
# sole source of the image-scan CVEs - tar, undici, sigstore, and brace-expansion all live inside
# npm's own dependency tree, not the app's. Removing it clears the vulnerability gate at the root
# without unpinning the base image. Runs as root (before USER 1000); -rf tolerates absent paths.
# See AIX/aix-proto#614.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/pnpm

# Per-app schema isolation: build-app.sh bakes APP_SCHEMA=<slug> (the shared deploy pipeline has no
# per-app env seam). db.js prefers it over the manifest name; empty default keeps local builds working.
ARG APP_SCHEMA=""
ENV APP_SCHEMA=$APP_SCHEMA

# Numeric UID (the node user's uid is 1000) so k8s `runAsNonRoot` can verify a non-root user without
# resolving a username against /etc/passwd.
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]
