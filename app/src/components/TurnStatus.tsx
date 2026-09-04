import { StyleSheet, Text, View } from "react-native";
import type { LatencySummary, TurnTiming } from "../telemetry/latency";
import { BUDGET_MS, withinBudget } from "../telemetry/latency";
import type { Transcript } from "../stt/types";
import { colour, radius, space, type } from "../theme";

/**
 * What the microphone heard, shown verbatim before the guidance built on it.
 *
 * The user has to be able to check the machine's perception, because every
 * layer below this trusts it. If the transcript is wrong the guidance will be
 * wrong in a way no downstream guard can catch — the engine's rejection layers
 * protect against a model inventing law, not against a microphone mishearing
 * a sentence.
 */
export function TranscriptChip({ transcript }: { transcript: Transcript }) {
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.label}>HEARD</Text>
        <Text style={s.provider}>
          {transcript.provider}
          {transcript.model ? ` · ${transcript.model}` : ""}
          {transcript.language ? ` · ${transcript.language}` : ""}
        </Text>
      </View>

      <Text style={s.text} selectable>
        {transcript.text}
      </Text>

      {transcript.simulated ? (
        <Notice
          tone="warn"
          title="SIMULATED — the audio was not transcribed"
          body="This is canned text from the mock provider. Any guidance below describes a situation that is not happening. Set KAVACH_STT_PROVIDER to use a real transcription endpoint."
        />
      ) : null}

      {transcript.classifierScriptMismatch ? (
        <Notice
          tone="warn"
          title="Devanagari transcript — the classifier will not match it"
          body="The transcription is correct, but the engine's scenario cues are written in Latin script, so this turn falls back to the general safe actions. This is a corpus gap, not a transcription failure."
        />
      ) : null}
    </View>
  );
}

function Notice({ tone, title, body }: { tone: "warn"; title: string; body: string }) {
  return (
    <View style={[s.notice, tone === "warn" && s.noticeWarn]}>
      <Text style={s.noticeTitle}>{title}</Text>
      <Text style={s.noticeBody}>{body}</Text>
    </View>
  );
}

/**
 * The latency readout.
 *
 * PRD Design Principle 4: an accurate answer delivered late is a failed
 * answer, so the number is on screen rather than in a log. The label says
 * "to guidance" and not "to first spoken word" because there is no speech
 * synthesis yet and the PRD's figure includes it — quoting the smaller number
 * against the PRD's budget would flatter the build.
 */
export function LatencyReadout({
  timing,
  summary,
}: {
  timing: TurnTiming | null;
  summary: LatencySummary;
}) {
  if (!timing) return null;

  const verdict = withinBudget(timing.total);
  const tone =
    verdict === "ok" ? colour.textFaint : verdict === "over-p95" ? colour.irregular : colour.unlawful;

  const parts: string[] = [];
  if (timing.capture !== null) parts.push(`capture ${fmt(timing.capture)}`);
  if (timing.transcribe !== null) parts.push(`transcribe ${fmt(timing.transcribe)}`);
  if (timing.engine !== null) parts.push(`engine ${fmt(timing.engine)}`);

  return (
    <View style={s.latency}>
      <View style={s.latencyRow}>
        <Text style={[s.latencyTotal, { color: tone }]}>{fmt(timing.total)}</Text>
        <Text style={s.latencyLabel}>
          tap to guidance{timing.source === "voice" ? " · voice" : " · typed"}
        </Text>
      </View>

      {parts.length > 0 ? <Text style={s.latencyParts}>{parts.join("  ·  ")}</Text> : null}

      <Text style={s.latencyBudget}>
        {verdict === "ok"
          ? `within the ${fmt(BUDGET_MS.p95)} budget`
          : verdict === "over-p95"
            ? `over the ${fmt(BUDGET_MS.p95)} p95 budget`
            : `over the ${fmt(BUDGET_MS.p99)} p99 budget`}
        {summary.medianMs !== null ? ` · median ${fmt(summary.medianMs)} over ${summary.count}` : ""}
        {summary.meaningful ? "" : " · too few turns for a percentile"}
      </Text>

      <Text style={s.latencyCaveat}>
        Measured to guidance on screen. The PRD budget is to first spoken word — with playback on a
        tap, that span also contains the time the user takes to reach for it, which is not ours to
        measure. The synthesis half is reported beside the Play button.
      </Text>
    </View>
  );
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },
  provider: { color: colour.textFaint, fontSize: type.small },
  text: { color: colour.text, fontSize: type.body, lineHeight: 23 },

  notice: { borderRadius: radius.sm, padding: space.sm, gap: 2, borderWidth: 1 },
  noticeWarn: { backgroundColor: colour.warnBg, borderColor: colour.warn },
  noticeTitle: { color: colour.warn, fontSize: type.small, fontWeight: "800" },
  noticeBody: { color: colour.text, fontSize: type.small, lineHeight: 17 },

  latency: { gap: 2 },
  latencyRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  latencyTotal: { fontSize: type.heading, fontWeight: "800", fontVariant: ["tabular-nums"] },
  latencyLabel: { color: colour.textFaint, fontSize: type.small },
  latencyParts: { color: colour.textFaint, fontSize: type.small, fontVariant: ["tabular-nums"] },
  latencyBudget: { color: colour.textFaint, fontSize: type.small },
  latencyCaveat: { color: colour.textFaint, fontSize: type.small, lineHeight: 16, fontStyle: "italic" },
});
