# Building Kavach for a real phone

Expo Go runs everything except three things, and those three are why this file
exists:

| | Expo Go | Real build |
|---|---|---|
| Recording keeps going when the screen locks | No — capture stops | Yes, under a persistent notification |
| "Start session" home-screen shortcut (PRD R1) | No | Yes — long-press the app icon |
| Talks to an engine over plain HTTP on your Wi-Fi | Yes | **No** — Android release builds refuse cleartext, so use HTTPS (below) |

**Status, 4 October 2026: none of the real-build behaviour has been run on a
device.** `expo prebuild` was run to confirm the generated Android manifest
carries the microphone foreground service, the notification permission and
the shortcut. Nothing more than that is verified.

## 1. Build the APK (about 15 minutes, mostly waiting)

```bash
npm install -g eas-cli
eas login                      # free Expo account
cd app
eas build -p android --profile preview
```

`preview` produces an APK you install directly: open the link EAS prints, on
the phone, and allow the install. Free-tier builds are queued, so the wait
varies. `eas.json` also has a `production` profile (an app bundle for the Play
Store). Leave it alone until the corpus is signed off.

## 2. Give the phone an HTTPS engine

A release build will not talk to `http://192.168.x.x:8787`. The quickest
HTTPS route needs no account and no domain:

```bash
# four terminals, from the repo root
cd kavach-engine && npm run dev
cd stt-service && npm run dev
cd evidence-service && npm run dev
node deploy/local-proxy.mjs                         # one origin on :8080
# fifth terminal: install cloudflared first
cloudflared tunnel --url http://localhost:8080      # prints https://<random>.trycloudflare.com
```

In the app, open **Settings** and set the engine address to
`https://<random>.trycloudflare.com/engine`. The client works out the STT and
evidence addresses from it. Enter the instance key from `.kavach-secrets.json`
(the `apiKey` field) in the same screen.

The tunnel URL changes every time `cloudflared` restarts. For anything longer
than one afternoon, use the real deployment in `deploy/`.

## 3. What to check on the phone

Write each result in `FIELD-NOTES.md` at the repo root, including failures.
Those notes are the input to the next round of work.

- [ ] **Shortcut.** Long-press the Kavach icon: "Start session" appears. Tap it.
      A session starts and recording begins, with no START tap.
- [ ] **Shortcut while a session is live.** Trigger it again. The live session
      must continue; no second session starts.
- [ ] **Locked-screen capture.** Start a session, talk for 10 s, lock the phone
      for 60 s while talking, then unlock. A "Kavach is recording" style
      notification must show while locked. After unlocking, the "safely off
      this phone" count must rise by one large chunk covering the locked span.
- [ ] **Notification permission** (Android 13+). If the system asks, note when.
      A prompt that appears mid-encounter is a design problem to record.
- [ ] **Evidence status line.** It should say "Keeps recording if the screen
      locks…". In Expo Go it should say the opposite.
- [ ] The rest of HANDOFF.md's handset list: TTS voices per language, the
      officer form at arm's length, the escalation draft editor, PDF export,
      SMS alert composer.

## Not yet built

- **Uploading while locked.** The recorder runs in the background; the
  JavaScript that rotates and uploads chunks does not. Audio recorded while
  locked is safe from being lost, but not from the phone being taken, until
  the app is reopened. Fixing this needs native rotation and upload inside the
  service. That is the next native task, because it closes R4's real promise.
- **Gapless capture.** Each rotation still stops and restarts the recorder.
- **Starting from the lock screen without unlocking.** Stock Android phones
  have no lock-screen widgets. The realistic path is a Quick Settings tile that
  launches an activity shown over the keyguard (`showWhenLocked`). That needs
  native Kotlin.
- **On-device speech recognition.** It would remove the STT round trip from the
  8-second budget.
