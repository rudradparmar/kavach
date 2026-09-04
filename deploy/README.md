# Deploying Kavach

Three services behind one hostname, on free infrastructure. The domain is the
only thing that costs money.

> **This corpus is unverified placeholder law.** No advocate has signed
> anything. `corpus/meta.json` status is `unverified`, every packet carries the
> warning, and the engine shouts it on every boot. Deploying this does not make
> it fit to put in front of a person. See "Before a real user" at the bottom.

---

## The shape

```
                    Cloudflare edge (TLS terminates here)
                              │
                   outbound-only tunnel
                              │
  ┌───────────────────────────┴───────────────────────────┐
  │  Oracle Always Free VM                                │
  │                                                       │
  │   cloudflared ──► caddy:80                            │
  │                     ├── /engine/*   ─► engine:8787    │
  │                     ├── /stt/*      ─► stt:8788       │
  │                     └── /evidence/* ─► evidence:8789  │
  │                                                       │
  │   volumes: sessions, evidence  (persistent disk)      │
  └───────────────────────────────────────────────────────┘
```

**One hostname, routed by path.** The client derives its sibling addresses from
the engine's URL — see `siblingUrl()` in `app/src/api/url.ts` — so pointing the
app at `https://api.<domain>/engine` reaches all three. No per-service
hostname, no ports, one certificate.

**No inbound port is opened.** `cloudflared` dials out to Cloudflare and
inbound traffic rides that connection back. The Oracle security list stays
closed and there is nothing to port-forward.

---

## Why this host

Both stores assume a real, persistent filesystem, and **neither says so when it
is missing.** The engine restores `0 sessions` and carries on; evidence-service
returns a clean 404 for audio that used to exist. On a platform with an
ephemeral disk, the service whose entire purpose is that a recording outlives
the handset that made it fails silently, and looks fine.

That rules out most free tiers. Render sleeps after 15 minutes idle and wipes
the disk; Fly has no free tier in 2026; Vercel and Workers have no
filesystem at all. **Oracle Cloud Always Free** — 4 ARM cores, 24 GB RAM,
200 GB block storage, never sleeps — is the one free option with real disk.

If ARM capacity is unavailable in your region (it often is), everything here
runs unchanged on any always-on machine, including an old laptop at home. The
tunnel means it does not need a public IP.

---

## Setup

### 1. The VM

Oracle Cloud → Compute → Instances → Create. Pick **Ampere A1 (ARM)**,
`VM.Standard.A1.Flex`, 4 OCPU / 24 GB, Ubuntu 22.04. Leave the security list
alone — nothing needs to be opened.

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
git clone <your-repo> kavach && cd kavach/deploy
```

### 2. The tunnel

Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel**.
Copy the token. Then under the tunnel's **Public Hostname** tab:

| Field | Value |
| --- | --- |
| Subdomain | `api` |
| Domain | your domain |
| Service | `HTTP` → `caddy:80` |

### 3. Secrets and start

```bash
cp .env.example .env
# Generate each of the two, separately:
openssl rand -base64 24 | tr -d '=+/'
$EDITOR .env          # fill KAVACH_API_KEY, KAVACH_SESSION_SECRET, CLOUDFLARE_TUNNEL_TOKEN

docker compose up -d --build
docker compose logs -f engine
```

The engine should print `auth: on · secrets from the environment`. If it says
`generated into .kavach-secrets.json` instead, the environment did not reach
it — see the trap below.

### 4. Check it

```bash
curl https://api.<domain>/engine/health
curl https://api.<domain>/stt/health
curl https://api.<domain>/evidence/health
```

Then in the app: Settings → engine address → `https://api.<domain>/engine`.
Nothing else needs configuring; the other two follow from it.

---

## The trap that will get you

`KAVACH_API_KEY` **and** `KAVACH_SESSION_SECRET` must both be set, and set
**identically on all three services**. `shared/auth.ts` requires the pair —
set only one and it falls through to generating a fresh pair per process, into
each container's own ephemeral filesystem. Everything boots, health checks
pass, and then every token the engine mints comes back `bad-signature` from the
other two. The compose file uses `${VAR:?}` so a missing value fails the run
instead of producing this.

---

## Verifying the deployed shape without Docker

The path-mounted routing is the part most likely to break, because development
runs port-mounted and never exercises it. `local-proxy.mjs` mirrors the
Caddyfile's `handle_path` blocks so it can be checked on a laptop:

```bash
cd kavach-engine    && npm run dev     # :8787
cd stt-service      && npm run dev     # :8788
cd evidence-service && npm run dev     # :8789
node deploy/local-proxy.mjs            # :8080

cd app
npm run smoke    -- http://localhost:8080/engine
npm run evidence -- http://localhost:8080/evidence
npm run pipeline -- http://localhost:8080/engine http://localhost:8080/stt
npm run auth     -- http://localhost:8080/engine http://localhost:8080/stt http://localhost:8080/evidence
```

All four pass with no port in any URL. CI runs this same matrix.

---

## What this deployment does and does not give you

**Does:** real TLS with a real certificate; no inbound ports; session
capabilities that contain to one encounter across all three services;
persistent storage for sessions and evidence; bounded retention; a rate-limit
rule at the edge.

**Does not:**

- **Per-user identity.** Everyone on a deployment shares one instance key. R1
  forbids a login, so authorisation attaches to the session rather than a
  person — that is a deliberate design choice, not an oversight, but it means
  a deployment is for one trusted group.
- **Key rotation.** Changing `KAVACH_API_KEY` invalidates nothing that was
  already minted until it expires.
- **Multi-replica.** The engine keeps sessions in a module-level `Map` and
  rehydrates only at boot. Do not scale it past one.
- **Protection from the host.** Session files hold verbatim transcripts of
  police encounters and the evidence volume holds the audio. Whoever controls
  the VM controls both. The PRD's open question about evidence jurisdiction and
  compelled production is not answered by any of this.

---

## Before a real user

Nothing here changes the gate. From `docs/engine-architecture.md`:

1. Advocate engaged and named.
2. Every provision checked against a bare act, gazette, or reported judgment.
3. Every quotable line reviewed for **escalation risk**, separately from legal
   accuracy.
4. `corpus/meta.json` status → `counsel-signed-off`.

Until then this is an engineering deployment, and the UNVERIFIED banner that
appears on every screen is the truth.
