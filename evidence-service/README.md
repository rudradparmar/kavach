# kavach-evidence-service

Takes chunks of audio, timestamps and hashes them at receipt, and keeps them.

```
POST   /session/:id/chunk?seq=N   raw bytes -> { seq, receivedAt, sha256 }
GET    /session/:id/manifest      what is held, with hashes and receipt times
GET    /session/:id/acks          sequence numbers stored, for resume
GET    /session/:id/chunk/:seq    the bytes back, playable
DELETE /session/:id               permanent deletion (PRD R4)
GET    /health                    (open; everything else needs a token)
```

```bash
npm install
npm test          # 16 assertions
npm run dev       # :8789
```

---

## Why it exists

PRD Design Principle 2: **the phone is not safe.** Phones get taken, switched
off and handed over, and evidence that lives only on the device is evidence
that can disappear. This service is where a recording stops depending on the
survival of the handset that made it.

Two properties make a stored chunk worth anything to a lawyer, and both are
established **here, at receipt**, never taken from the uploader:

| | |
|---|---|
| **Timestamp** | the server's clock when the bytes arrived |
| **Content hash** | SHA-256 recomputed over the bytes as received |

A hash the client supplies attests only that the client is consistent with
itself. Recomputing it on arrival is what lets someone later say *this file is
the file that was received at that moment*. The device's own `capturedAt` claim
is stored alongside, not instead.

## Why it is a separate service

Same reason as `stt-service`, one step more serious. An advocate reading
`kavach-engine/` should find corpus, deterministic rules and the output guard,
and nothing else. This service reads no corpus and authors no legal claim.

It is also where the PRD's unanswered question bites hardest — *"where does
evidence live, under whose jurisdiction, and who can be compelled to produce
it? A subpoena to the evidence host is a foreseeable attack on the product's
core promise."* Keeping custody separately deployable is what leaves that
answerable later instead of baking one answer into the engine.

## The trade, and what bounds it

This directory holds **audio of encounters with police**. Durability is not a
free win, so it ships with the things that make it defensible:

- **Deletion** is immediate and permanent, and takes the audio with it — PRD R4
  requires the user can delete a session's evidence, honoured within 24 hours.
  The app calls it alongside the engine's own delete, because evidence removed
  from one place has not been removed.
- **Retention** is bounded by `KAVACH_EVIDENCE_RETENTION_DAYS` (30), swept on
  boot, keyed off the last chunk received.
- **A per-session cap** (`KAVACH_EVIDENCE_MAX_SESSION_MB`, 200) so one client
  cannot fill the disk holding everyone else's evidence.

Writes are atomic (temp file plus rename), a corrupt manifest reads as absent
rather than crashing, and a session id from a URL path is validated as a UUID
before it is joined to any path.

## Resumption

Uploads are **idempotent on `seq`**. A client that uploaded successfully but
lost the acknowledgement will retry, and ten seconds of an encounter must not
end up stored twice under two numbers; a repeat returns the original receipt
with `duplicate: true` and a 200 rather than a 201.

`GET /session/:id/acks` is how a phone that was switched off works out what it
still owes.

## What it does not do

- **Authenticate people.** Every route except `/health` needs a session token
  minted by the engine, and a token for one session returns 403 on another —
  so a guessed UUID gets nothing. But there is no *user* behind it: anyone
  holding a deployment's instance key can start sessions and reach their
  audio. See `shared/README.md`.
- **Encrypt at rest.** Chunks arrive already encrypted in transit only if you
  put TLS in front of it; on disk they are plain audio. The device-side queue
  *is* encrypted (AES-256-GCM, key in the platform keystore) — that protects
  the phone, which is the threat the PRD names. Protecting the host is a
  deployment question tangled up with the subpoena one above.
- **Transcode or verify playability.** Bytes in, same bytes out.
