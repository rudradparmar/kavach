import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { createSession, getHealth, sendTurn } from "./src/api/client";
import { loadApiKey, saveApiKey } from "./src/api/auth";
import { clearBaseUrl, defaultBaseUrl, loadBaseUrl, saveBaseUrl } from "./src/api/config";
import type { GuardViolation, GuidanceUpdate, Health, RaisedFlag, Speaker } from "./src/api/types";
import { AlertSheet } from "./src/components/AlertSheet";
import { getAlertLocation } from "./src/contacts/location";
import { composeAlert } from "./src/contacts/message";
import { sendViaData, sendViaSms, type DispatchResult } from "./src/contacts/send";
import {
  loadContacts,
  loadUserName,
  saveContacts,
  saveUserName,
  type TrustedContact,
} from "./src/contacts/storage";
import { EMPTY as EMPTY_CORPUS, loadCorpusCache, type CorpusCacheState } from "./src/offline/corpusCache";
import { ContactsScreen } from "./src/screens/ContactsScreen";
import { PacketScreen } from "./src/screens/PacketScreen";
import { ScenarioCardScreen } from "./src/screens/ScenarioCardScreen";
import { SessionScreen } from "./src/screens/SessionScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { StartScreen } from "./src/screens/StartScreen";
import { getSttHealth, transcribe } from "./src/stt/client";
import { loadSttUrl } from "./src/stt/storage";
import type { SttHealth, Transcript } from "./src/stt/types";
import {
  deleteEvidence,
  defaultEvidenceUrl,
  getAcknowledged,
  getEvidenceHealth,
  type EvidenceHealth,
} from "./src/evidence/client";
import { discard, drain, enqueue, pending, reconcile } from "./src/evidence/queue";
import { useCapture, type CapturedChunk } from "./src/evidence/useCapture";
import type { LatencySummary, TurnTiming } from "./src/telemetry/latency";
import { summarise, TurnTimer } from "./src/telemetry/latency";
import { stopSpeaking, useSpeech } from "./src/tts/speech";
import { colour, radius, space, type } from "./src/theme";

type Route = "start" | "session" | "settings" | "scenario" | "packet" | "contacts";

/**
 * Application shell.
 *
 * It owns the one pipeline that matters: audio → words → turn → guidance. The
 * important property is that only the first two steps know audio exists. By
 * the time anything reaches `sendTurn` it is plain text and a speaker label —
 * the same thing the text box produces — so the engine, the rendering, and the
 * lawyer packet are all indifferent to how the words were captured.
 */
export default function App() {
  const [route, setRoute] = useState<Route>("start");

  const [baseUrl, setBaseUrl] = useState<string>(defaultBaseUrl());
  const [sttUrl, setSttUrl] = useState<string | null>(null);
  const [baseUrlReady, setBaseUrlReady] = useState(false);

  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [sttHealth, setSttHealth] = useState<SttHealth | null>(null);
  const [corpus, setCorpus] = useState<CorpusCacheState>(EMPTY_CORPUS);
  const [scenarioId, setScenarioId] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  /**
   * The capability for this encounter. Deliberately not persisted — a token
   * sitting in storage after the session is over is a capability nobody is
   * using and someone could take.
   */
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [userName, setUserName] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertPreparing, setAlertPreparing] = useState(false);
  const [alertResults, setAlertResults] = useState<DispatchResult[]>([]);

  const [evidenceHealth, setEvidenceHealth] = useState<EvidenceHealth | null>(null);
  const [evidenceSafe, setEvidenceSafe] = useState(0);
  const [evidencePending, setEvidencePending] = useState(0);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  /** The chunk handler runs off a timer and cannot see React state. */
  const sessionIdRef = useRef<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [update, setUpdate] = useState<GuidanceUpdate | null>(null);
  const [flags, setFlags] = useState<RaisedFlag[]>([]);
  const [violations, setViolations] = useState<GuardViolation[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [timings, setTimings] = useState<TurnTiming[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [speaker, setSpeaker] = useState<Speaker>("officer");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);

  const evidenceUrl = defaultEvidenceUrl(baseUrl);

  /**
   * How much of this encounter is actually off the phone.
   *
   * Two separate numbers rather than a percentage, because "12 chunks safe, 3
   * still on this phone" is something a frightened person can act on and "80%"
   * is not. PRD R4 requires the user be "told plainly that evidence is not yet
   * safe".
   */
  const refreshEvidence = useCallback(
    async (sid: string) => {
      try {
        setEvidencePending((await pending(sid)).length);
      } catch {
        /* the count is a display detail; never fail capture over it */
      }
      try {
        setEvidenceSafe((await getAcknowledged(evidenceUrl, sid, sessionTokenRef.current)).length);
        setEvidenceError(null);
      } catch (e) {
        setEvidenceError((e as Error).message);
      }
    },
    [evidenceUrl],
  );

  /**
   * Every chunk the microphone produces, encrypted and queued at once.
   *
   * Enqueue first, upload second. A chunk that is queued and unsent is
   * recoverable; a chunk dropped because the network was down is gone, and
   * that is the failure PRD R4 exists to prevent.
   */
  const handleChunk = useCallback(
    (chunk: CapturedChunk) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      void enqueue(sid, chunk.seq, chunk.uri, {
        capturedAt: chunk.capturedAt,
        mime: chunk.mime,
        latitude: null,
        longitude: null,
      })
        .then(() => drain(evidenceUrl, sessionTokenRef.current, sid))
        .then((report) => {
          if (report.uploaded > 0 || report.stoppedBecause) void refreshEvidence(sid);
        })
        .catch((e) => setEvidenceError((e as Error).message));
    },
    [evidenceUrl],
  );

  const capture = useCapture({ onChunk: handleChunk });
  const speech = useSpeech();

  /**
   * Stop playback the moment the guidance underneath it changes.
   *
   * A line that keeps playing after the scenario moved is a sentence being
   * said aloud to an officer with nothing on screen that still supports it —
   * the one failure mode worse than silence.
   */
  useEffect(() => {
    stopSpeaking();
  }, [update?.turnIndex, update?.scenarioId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadContacts(), loadUserName(), loadApiKey()]).then(([c, n, k]) => {
      if (cancelled) return;
      setContacts(c);
      setUserName(n);
      setApiKey(k);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadBaseUrl().then(async (url) => {
      if (cancelled) return;
      setBaseUrl(url);
      setSttUrl(await loadSttUrl(url));
      setBaseUrlReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const checkHealth = useCallback(async (engineUrl: string, speechUrl: string | null) => {
    setChecking(true);
    setHealthError(null);
    try {
      setHealth(await getHealth(engineUrl));
    } catch (e) {
      setHealth(null);
      setHealthError((e as Error).message);
    } finally {
      setChecking(false);
    }

    // The speech service is optional. Its absence disables the microphone and
    // nothing else — the text composer is a complete input on its own.
    if (!speechUrl) return setSttHealth(null);
    try {
      setSttHealth(await getSttHealth(speechUrl));
    } catch {
      setSttHealth(null);
    }

    // Evidence custody is optional in the same way: without it the guidance
    // loop is unaffected and only the recording has nowhere safe to go.
    try {
      setEvidenceHealth(await getEvidenceHealth(defaultEvidenceUrl(engineUrl)));
    } catch {
      setEvidenceHealth(null);
    }
  }, []);

  useEffect(() => {
    if (baseUrlReady) void checkHealth(baseUrl, sttUrl);
  }, [baseUrlReady, baseUrl, sttUrl, checkHealth]);

  /**
   * Keep the offline corpus current (PRD R10).
   *
   * Runs after the health check so the cached version can be compared against
   * what the engine is serving. It deliberately does not block anything: if
   * this fails the session path is unaffected, and only the scenario cards go
   * missing.
   */
  useEffect(() => {
    if (!baseUrlReady) return;
    let cancelled = false;
    loadCorpusCache(baseUrl, apiKey, health?.corpusVersion ?? null).then((state) => {
      if (!cancelled) setCorpus(state);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrlReady, baseUrl, apiKey, health?.corpusVersion]);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const created = await createSession(baseUrl, apiKey);
      setSessionId(created.sessionId);
      sessionIdRef.current = created.sessionId;
      setSessionToken(created.sessionToken ?? null);
      sessionTokenRef.current = created.sessionToken ?? null;
      setEvidenceSafe(0);
      setEvidencePending(0);
      setEvidenceError(null);
      // Capture starts with the session, not on a separate tap. R4 is
      // "continuous audio from session start"; an opt-in would mean the
      // evidence is missing exactly when someone forgot to press it.
      void capture.start();
      setUpdate(null);
      setFlags([]);
      setViolations([]);
      setTranscript(null);
      setTimings([]);
      setTurnCount(0);
      setTurnError(null);
      setRoute("session");
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }, [baseUrl, apiKey, capture]);

  /**
   * The single path a turn takes, whatever produced it.
   *
   * `timer` is started by the caller at the moment the user acted — button
   * release for speech, Send for typing — so the measured span is the one the
   * PRD cares about rather than the one that flatters the build.
   */
  const ingest = useCallback(
    async (text: string, who: Speaker, timer: TurnTimer) => {
      if (!sessionId) return;
      setBusyLabel("Working out what this is…");
      try {
        const result = await sendTurn(baseUrl, sessionId, text, who, sessionToken);
        timer.mark("engine");

        setUpdate(result.update);
        setViolations(result.violations);
        setTurnCount((n) => n + 1);

        // A flag stays true after the turn that raised it; the engine only
        // reports what is new, so the running set is assembled here.
        if (result.update.newFlags.length > 0) {
          setFlags((prev) => {
            const seen = new Set(prev.map((f) => f.ruleId));
            const added = result.update.newFlags.filter((f) => !seen.has(f.ruleId));
            return added.length > 0 ? [...prev, ...added] : prev;
          });
        }

        setTimings((prev) => [...prev, timer.finish()]);
      } catch (e) {
        setTurnError((e as Error).message);
      } finally {
        setBusy(false);
        setBusyLabel(null);
      }
    },
    [baseUrl, sessionId, sessionToken],
  );

  const sendText = useCallback(
    (text: string) => {
      setBusy(true);
      setTurnError(null);
      setTranscript(null);
      void ingest(text, speaker, new TurnTimer("text"));
    },
    [ingest, speaker],
  );

  const startRecording = useCallback(() => {
    setTurnError(null);
    void capture.beginSpeech();
  }, [capture]);

  const stopRecording = useCallback(async () => {
    const timer = new TurnTimer("voice");
    setBusy(true);
    setBusyLabel("Listening back…");

    // The segment between the two rotations IS the utterance, and it has
    // already been handed to the evidence queue by onChunk — so transcribing
    // it never costs the record a word.
    const segment = await capture.endSpeech();
    timer.mark("capture");

    if (!segment) {
      setBusy(false);
      setBusyLabel(null);
      setTurnError(capture.error ?? "Nothing was recorded.");
      return;
    }
    const recording = { uri: segment.uri, contentType: segment.mime, durationMs: 0 };
    if (!sttUrl) {
      setBusy(false);
      setBusyLabel(null);
      setTurnError("No transcription service configured. Type the turn instead.");
      return;
    }

    setBusyLabel("Transcribing…");
    let heard: Transcript;
    try {
      // Hindi hint rather than a hard language lock: roadside speech is
      // routinely Hindi-English code-mixed and forcing the wrong one is worse
      // than letting the provider decide.
      heard = await transcribe(sttUrl, recording, "hi", sessionToken);
      timer.mark("transcribe");
    } catch (e) {
      setBusy(false);
      setBusyLabel(null);
      setTurnError((e as Error).message);
      return;
    }

    setTranscript(heard);

    if (heard.text.trim().length === 0) {
      setBusy(false);
      setBusyLabel(null);
      setTurnError("Nothing was heard in that recording.");
      return;
    }

    // Sent without a confirmation step. The engine's confidence floor is the
    // safety net for bad perception — a garbled transcript classifies to the
    // fallback and the user gets the universal safe actions, which is the
    // correct outcome. An extra tap costs more than it buys inside a
    // ninety-second encounter (PRD Design Principle 4).
    await ingest(heard.text, speaker, timer);
  }, [ingest, capture, speaker, sttUrl, sessionToken]);

  /** Throw the session away. Only reached once the packet has been offered. */
  const discardSession = useCallback(() => {
    stopSpeaking();
    void capture.stop();
    sessionIdRef.current = null;
    setSessionToken(null);
    sessionTokenRef.current = null;
    setRoute("start");
    setSessionId(null);
    setUpdate(null);
    setFlags([]);
    setViolations([]);
    setTranscript(null);
    setTimings([]);
    setTurnCount(0);
    setTurnError(null);
    void checkHealth(baseUrl, sttUrl);
  }, [baseUrl, sttUrl, checkHealth]);

  /**
   * Ending a session offers the packet rather than binning the encounter.
   *
   * HANDOFF calls the packet "the artifact that makes the ninety seconds worth
   * anything afterwards", and the engine holds sessions in memory — so walking
   * away from this screen without seeing it is how the record gets lost. A
   * session with no turns has nothing to hand anyone, so that goes straight
   * back to the start.
   */
  const endSession = useCallback(() => {
    stopSpeaking();
    void capture.stop();
    if (turnCount === 0) {
      discardSession();
      return;
    }
    setRoute("packet");
  }, [turnCount, discardSession]);

  /**
   * Open the alert and build the message.
   *
   * The location fix happens here rather than on send, so the user sees the
   * exact text — coordinates included — before any of it leaves the phone.
   * A police-encounter summary and a live location are not things you can
   * unsend, and the person deciding is frightened and not reading carefully.
   */
  const openAlert = useCallback(async () => {
    setAlertOpen(true);
    setAlertResults([]);
    setAlertMessage(null);
    setAlertPreparing(true);

    const { location, problem } = await getAlertLocation();

    setAlertMessage(
      composeAlert({
        userName,
        // Corpus text, and only when the engine was actually confident. The
        // fallback deliberately has no title to offer.
        scenarioTitle: update && !update.fallback ? update.scenarioTitle : null,
        at: new Date(),
        location,
        locationProblem: problem,
        sessionRef: sessionId ? sessionId.slice(0, 8) : "—",
      }),
    );
    setAlertPreparing(false);
  }, [userName, update, sessionId]);

  /**
   * Keep trying to get the queue off the phone.
   *
   * PRD R4: chunks "upload automatically on reconnection". Nobody in an
   * encounter is going to notice a failed upload and press retry, so this runs
   * on a timer for as long as a session is live and stops when it is not.
   */
  useEffect(() => {
    if (route !== "session" || !sessionId) return;
    const id = setInterval(() => {
      void drain(evidenceUrl, sessionToken, sessionId).then((r) => {
        if (r.uploaded > 0 || r.stoppedBecause) void refreshEvidence(sessionId);
      });
    }, 15_000);
    return () => clearInterval(id);
  }, [route, sessionId, sessionToken, evidenceUrl, refreshEvidence]);

  /**
   * Resume after the app was killed mid-encounter.
   *
   * The phone may have uploaded a chunk and died before recording the
   * acknowledgement. Asking what the service already holds avoids re-sending
   * it, even though the service would deduplicate anyway.
   */
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getAcknowledged(evidenceUrl, sessionId, sessionToken)
      .then(async (acked) => {
        if (cancelled) return;
        await reconcile(evidenceUrl, sessionId, acked);
        await refreshEvidence(sessionId);
      })
      .catch(() => {
        /* offline at session start is normal; the drain timer will catch up */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionToken, evidenceUrl, refreshEvidence]);

  const handleSaveContacts = useCallback(async (next: TrustedContact[]) => {
    setContacts(next);
    await saveContacts(next);
  }, []);

  const handleSaveName = useCallback(async (name: string) => {
    setUserName(name.trim().length > 0 ? name.trim() : null);
    await saveUserName(name);
  }, []);

  const handleSaveUrl = useCallback(async (url: string) => {
    await saveBaseUrl(url);
    setBaseUrl(url);
    setSttUrl(await loadSttUrl(url));
  }, []);

  const handleResetUrl = useCallback(async () => {
    await clearBaseUrl();
    const fresh = defaultBaseUrl();
    setBaseUrl(fresh);
    setSttUrl(await loadSttUrl(fresh));
  }, []);

  const latency: LatencySummary = summarise(timings);
  const lastTiming = timings.length > 0 ? (timings[timings.length - 1] ?? null) : null;

  const openScenario = scenarioId
    ? (corpus.payload?.scenarios.find((sc) => sc.id === scenarioId) ?? null)
    : null;
  // Only the provisions this scenario cites — a card that listed all twenty
  // would be a reading exercise, not a reference.
  const scenarioProvisions = openScenario
    ? (corpus.payload?.provisions.filter((p) => openScenario.provisionIds.includes(p.id)) ?? [])
    : [];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {route === "settings" ? (
        <SettingsScreen
          baseUrl={baseUrl}
          sttUrl={sttUrl}
          apiKey={apiKey}
          onSaveApiKey={async (k) => {
            await saveApiKey(k);
            setApiKey(k.trim().length > 0 ? k.trim() : null);
          }}
          onSave={handleSaveUrl}
          onReset={handleResetUrl}
          onClose={() => setRoute(sessionId ? "session" : "start")}
        />
      ) : route === "session" && sessionId ? (
        <>
          <SessionScreen
            sessionId={sessionId}
            update={update}
            allFlags={flags}
            transcript={transcript}
            evidence={{
              capturing: capture.capturing,
              safe: evidenceSafe,
              pendingCount: evidencePending,
              serviceReachable: evidenceHealth !== null,
              error: evidenceError,
            }}
            speech={speech}
            timing={lastTiming}
            latency={latency}
            turnCount={turnCount}
            corpusStatus={health?.corpusStatus ?? "unverified"}
            corpusVersion={health?.corpusVersion ?? null}
            speaker={speaker}
            onSpeakerChange={setSpeaker}
            busy={busy}
            busyLabel={busyLabel}
            error={turnError ?? capture.error ?? evidenceError}
            isRecording={capture.isRecording}
            recordingMs={capture.durationMs}
            permission={capture.permission}
            sttReady={sttHealth !== null}
            onSendText={sendText}
            onStartRecording={startRecording}
            onStopRecording={() => void stopRecording()}
            onAlert={() => void openAlert()}
            onEnd={endSession}
          />
          <GuardNotice violations={violations} />
        </>
      ) : route === "contacts" ? (
        <ContactsScreen
          contacts={contacts}
          userName={userName}
          onSave={handleSaveContacts}
          onSaveName={handleSaveName}
          onClose={() => setRoute(sessionId ? "session" : "start")}
        />
      ) : route === "packet" && sessionId ? (
        <PacketScreen
          baseUrl={baseUrl}
          sessionId={sessionId}
          sessionToken={sessionToken}
          onDeleteEvidence={async () => {
            await discard(sessionId);
            await deleteEvidence(evidenceUrl, sessionId, sessionToken);
          }}
          retentionDays={
            health?.persistence === false || health?.persistence === undefined
              ? null
              : health.persistence.retentionDays
          }
          onDone={discardSession}
        />
      ) : route === "scenario" && openScenario && corpus.payload ? (
        <ScenarioCardScreen
          scenario={openScenario}
          provisions={scenarioProvisions}
          meta={corpus.payload.meta}
          speech={speech}
          offline={health === null}
          corpusFetchedAt={corpus.fetchedAt}
          stale={corpus.stale}
          onStartSession={() => {
            setScenarioId(null);
            void start();
          }}
          onBack={() => {
            stopSpeaking();
            setScenarioId(null);
            setRoute("start");
          }}
        />
      ) : (
        <StartScreen
          health={health}
          healthError={healthError}
          checking={checking}
          baseUrl={baseUrl}
          sttHealth={sttHealth}
          corpus={corpus}
          starting={starting}
          startError={startError}
          onStart={start}
          onOpenSettings={() => setRoute("settings")}
          onRetryHealth={() => void checkHealth(baseUrl, sttUrl)}
          contactCount={contacts.length}
          onOpenContacts={() => setRoute("contacts")}
          onOpenScenario={(id) => {
            setScenarioId(id);
            setRoute("scenario");
          }}
        />
      )}
      <AlertSheet
        visible={alertOpen}
        contacts={contacts}
        message={alertMessage}
        preparing={alertPreparing}
        results={alertResults}
        onSendSms={() => {
          void sendViaSms(contacts, alertMessage ?? "").then((r) =>
            setAlertResults((prev) => [...prev, r]),
          );
        }}
        onSendData={() => {
          void sendViaData(alertMessage ?? "").then((r) =>
            setAlertResults((prev) => [...prev, r]),
          );
        }}
        onClose={() => setAlertOpen(false)}
        onConfigure={() => {
          setAlertOpen(false);
          setRoute("contacts");
        }}
      />
    </SafeAreaView>
  );
}

/**
 * The output guard tripped and the engine degraded this turn to the universal
 * safe actions. That is the system working, but it means corpus wording needs
 * fixing, so it is surfaced rather than swallowed — silently rendering a
 * degraded answer would hide the one signal that says the corpus is wrong.
 *
 * CLAUDE.md invariant 2: the fix is always to reword the corpus, never to
 * loosen the guard.
 */
function GuardNotice({ violations }: { violations: GuardViolation[] }) {
  if (violations.length === 0) return null;
  return (
    <View style={styles.guard}>
      <Text style={styles.guardTitle}>OUTPUT GUARD TRIPPED — degraded to safe actions</Text>
      {violations.map((v, i) => (
        <Text key={i} style={styles.guardLine}>
          {v.kind}: {v.detail}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colour.bg },
  guard: {
    margin: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.warn,
    backgroundColor: colour.warnBg,
    gap: 2,
  },
  guardTitle: { color: colour.warn, fontSize: type.small, fontWeight: "800", letterSpacing: 0.6 },
  guardLine: { color: colour.text, fontSize: type.small, lineHeight: 17 },
});
