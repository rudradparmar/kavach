# shared/

One file, imported by all three services: `auth.ts`.

It is a plain file rather than a package because the services are deliberately
standalone — `stt-service` and `evidence-service` must not depend on
`kavach-engine`, since an advocate reading the engine should find corpus,
deterministic rules and the output guard and nothing else. A shared *secret* is
not a shared dependency.

## The model

There is no login. PRD R1 is explicit — *"Single tap starts a session — no
login, no menu, no scenario picker"* — so authorisation attaches to the
**session**, not to a person. The user has no account, no password, and nothing
to remember.

| | what it is | what it opens |
|---|---|---|
| **Instance key** | one secret per deployment, typed into the app once | starting a session, reading the corpus |
| **Session token** | minted by the engine per session, HMAC-signed | that one session, on all three services |

A leaked session token exposes one encounter and expires (12h default). A
leaked instance key lets someone start new sessions — a nuisance, not a
disclosure. That split is the point.

**Why HMAC and not a lookup:** `stt-service` and `evidence-service` verify a
capability the engine issued without a round trip, a database, or any knowledge
that the engine exists.

**What stays open:** `/health` on all three. It is the app's reachability probe
and discloses only that a service is running. Everything else needs a token.

## Secrets

Resolved in order: `KAVACH_API_KEY` + `KAVACH_SESSION_SECRET` from the
environment, then `.kavach-secrets.json` at the repo root, then freshly
generated into that file.

The file exists so three `npm run dev` terminals work with no setup **and**
still have auth on. Making the zero-config path the insecure one is how
services end up deployed wide open, so here the zero-config path is the secure
one and the escape hatch is explicit: `KAVACH_AUTH=0`, which prints a warning
on every boot.

`.kavach-secrets.json` is gitignored and written `0600`. Use a real secret
manager for anything that is not a laptop.

## What this is not

- **Not transport security.** Put TLS in front of these before they leave a
  trusted network; a bearer token over plain HTTP is a token anyone on the path
  can read.
- **Not rate limiting.** Nothing here slows down someone guessing the instance
  key, and the key is the weakest link because it does not rotate.
- **Not per-user.** Two people sharing a deployment share an instance key. Real
  multi-tenancy needs an identity model the PRD has not asked for.
