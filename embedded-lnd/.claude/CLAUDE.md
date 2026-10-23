# Project conventions

## Server

All work for this project happens on the remote server, not locally.

- SSH alias: `tester-98` (defined in `~/.ssh/config`)
- Host: `192.243.215.98`, user: `tester`, hostname `srv02` (Ubuntu, Linux 6.8)
- Access verified working with `ssh tester-98`.

## Working directory rule

**Everything the user asks for goes under `/vm` on `tester-98`.**

Whenever the user asks for a task in this codebase, work under the `/vm`
folder on that server. Do not create or edit project files elsewhere on the
server (no `/home/tester`, no `/opt`, no `/tmp` for deliverables), and do not
assume the local Windows checkout is the working copy.

Existing layout under `/vm`:

- `/vm/2026`     — VM images / project dirs (root:libvirt)
- `/vm/git`      — git checkouts (owned by `tester`)
- `/vm/docker`   — docker data (root only)
- `/vm/minikube` — minikube state (owned by `tester`)
- `/vm/cd`, `/vm/docker-bkp2`, `/vm/.env`

Note: `/vm` itself is owned by `lqwd:lqwd` and is not writable by `tester`
directly — use the subdirectories `tester` owns (`/vm/git`, `/vm/minikube`),
or `sudo` when a new top-level dir is genuinely needed.

## Checkouts and git workflow

- **Local** (Windows): `c:/Users/Lenovo/Desktop/Data/Work/LQWDCodes/git/2026/embedded-lnd`
  Remote `origin` = `git@github.com:lqwdtech/embedded-lnd.git` (personal key, `mghd1366`).
- **Server**: `/vm/git/embedded-lnd` on `tester-98`
  Remote `origin` = `git@github-embedded-lnd:lqwdtech/embedded-lnd.git`
  (per-repo deploy key `~/.ssh/id_ed25519_embedded_lnd`, aliased in the
  server's `~/.ssh/config` as `github-embedded-lnd`).

`develop` is the working branch on both sides; both track `origin/develop`.

- Edit and commit **locally**, then `git push` to `develop`.
- On the server, `git pull` `develop`. Do not author changes there — the
  server checkout is a build/test workspace.

`/vm` has ~3.1T free, which is where Yocto build output (downloads, sstate,
tmp) belongs — never under `/` (98G, already 58% used).

## Project goal

Yocto-based ARM builds of lnd for single-board computers. First target is the
Raspberry Pi 4 Model B (hardware on hand); after that POC works, newer boards
and hardened/secure-boot targets.
