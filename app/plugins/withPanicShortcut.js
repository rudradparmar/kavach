/**
 * PRD R1 — a home-screen entry that starts a session in one tap.
 *
 * Adds a static Android app shortcut: long-press the Kavach icon and a "Start
 * session" item appears, which can also be dragged to the home screen as an
 * icon of its own. It opens `kavach://start`, which App.tsx turns into a
 * session with no further tap (src/entry/panicLink.ts).
 *
 * Static shortcuts need no library and no runtime code, which is why this is
 * the first native entry rather than a widget. What it is not: a lock-screen
 * entry. Stock Android phones do not offer lock-screen widgets, and starting
 * without unlocking needs an activity shown over the keyguard — a separate,
 * larger piece of native work (see app/BUILD.md, "Not yet built").
 *
 * Applied only by a real build (`eas build` / `expo prebuild`). Expo Go
 * ignores it. UNTESTED ON A DEVICE as of 4 October 2026.
 */
const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} = require("expo/config-plugins");

const SHORTCUT_XML = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
      android:shortcutId="start_session"
      android:enabled="true"
      android:icon="@mipmap/ic_launcher"
      android:shortcutShortLabel="@string/kavach_shortcut_start_short"
      android:shortcutLongLabel="@string/kavach_shortcut_start_long">
    <intent
        android:action="android.intent.action.VIEW"
        android:data="kavach://start"
        android:targetPackage="${pkg}"
        android:targetClass="${pkg}.MainActivity" />
  </shortcut>
</shortcuts>
`;

// Calm on purpose. An officer may read this label over the user's shoulder,
// and the PRD flags a confrontational name as a design flaw.
const SHORT_LABEL = "Start session";
const LONG_LABEL = "Start a Kavach session";

const withShortcutFile = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error("withPanicShortcut: expo.android.package is required");
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "kavach_shortcuts.xml"), SHORTCUT_XML(pkg));
      return cfg;
    },
  ]);

const withShortcutStrings = (config) =>
  withStringsXml(config, (cfg) => {
    const set = (name, value) =>
      AndroidConfig.Strings.setStringItem(
        [{ $: { name, translatable: "false" }, _: value }],
        cfg.modResults,
      );
    cfg.modResults = set("kavach_shortcut_start_short", SHORT_LABEL);
    cfg.modResults = set("kavach_shortcut_start_long", LONG_LABEL);
    return cfg;
  });

const withShortcutMeta = (config) =>
  withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const meta = (activity["meta-data"] = activity["meta-data"] ?? []);
    if (!meta.some((m) => m.$["android:name"] === "android.app.shortcuts")) {
      meta.push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/kavach_shortcuts" } });
    }
    return cfg;
  });

module.exports = function withPanicShortcut(config) {
  return withShortcutMeta(withShortcutStrings(withShortcutFile(config)));
};
