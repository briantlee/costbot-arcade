# arcade/app — the aix-proto app, mirrored

Everything here is the **server half** of the CostBot Arcade: the Node app that
serves `arcade/` behind MyID and backs it with Postgres. It is not web content, and
nothing in this directory is ever served to a browser.

## Why it lives in two places

The app itself lives in a different repo — `AIX/aix-proto`, at
`examples/costbot-arcade/` — because that is where the platform's CI builds the
image from. For a long time these files existed **only** there, which meant:

- no history in this repo, so `git log` on the arcade told you nothing about the API
- no diff, so an edit made in `~/aix-proto` was invisible from here
- no backup, since `sync-to-app.sh` only ever copied `public/`

That bit us. A session edited `server.js` directly in `~/aix-proto`, in a clone that
was a commit behind `origin/main`. From this repo nothing had changed; from that
clone it looked as though an earlier deploy's work had been reverted. Establishing
which was true took a three-way diff that should not have been necessary.

So these files are mirrored here, and **this copy is the source of truth.**

## The rules

`arcade/tools/sync-to-app.sh` copies both halves in the same direction:

```
arcade/*       ->  <app>/public/     the games (generated — overwritten freely)
arcade/app/*   ->  <app>/            these files (guarded — see below)
```

`public/` is generated, so the script overwrites it without asking. **These files
are not**, so they are copied *guarded*: if a file in the app dir differs from its
mirror here, the sync refuses to run and makes you choose.

```bash
./tools/sync-to-app.sh --check    # is anything out of step, in either direction?
./tools/sync-to-app.sh --adopt    # keep the app-side edit: copy it back into here
./tools/sync-to-app.sh --force    # discard the app-side edit: overwrite from here
```

That refusal is the whole point — it is the difference between noticing a
divergence and silently destroying someone's work. `--check` compares **content**
rather than timestamps, because a git checkout rewrites every mtime and would
otherwise report wall-to-wall drift that is not real.

## What is deliberately NOT mirrored

| Not here | Why |
|---|---|
| `public/` | Generated from `arcade/` by the same script |
| `node_modules/` | Installed during the image build |
| `.manifest.json.aix.lock`, `.package.json.aix.lock` | Empty sentinels the platform scaffold owns. They mark `manifest.json` / `package.json` as scaffold-managed and carry no content |
| the app dir's own `README.md` | Untouched starter boilerplate ("Your aix-proto app", pointing at `examples/_template`). This file is a different document, so the two must not overwrite each other |

## Two exclusions that matter

This is **server source sitting inside a GitHub Pages tree**, so it is kept out of
the two places that would otherwise serve it:

1. **`_config.yml`** excludes `arcade/app`, so Jekyll does not publish it. Jekyll
   excludes only three directories by default, so anything in the repo is served
   unless it is named.
2. **`sync-to-app.sh`** excludes `app/` from the `public/` rsync. `arcade/app/` is a
   subdirectory of `arcade/`, so without that rule it would be copied into
   `public/`, ship inside the image, and be readable at `/a/costbot-arcade/app/` by
   every authenticated user. The script then **asserts** `public/app` does not
   exist after every run — so if that rule is ever dropped, the sync fails loudly
   instead of quietly publishing the server.

Nothing here holds a credential (a secret scan gates every deploy), so neither is a
disclosure emergency. But server source is not web content and should not be
reachable as though it were.

## Running the tests

From the app dir, not from here — they need the app's `node_modules`:

```bash
cd ~/aix-proto/examples/costbot-arcade && npm test
```
