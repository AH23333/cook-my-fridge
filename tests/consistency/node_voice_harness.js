/* Headless test for voice.js (Web Speech API glue with a stub recognizer).
   Usage: node node_voice_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}
load("web/js/voice.js");

const CMF = global.window.CMF;
const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

// Unsupported browser: no throw, error code, noop stop.
check("unsupported detected", CMF.voiceSupported() === false);
let unsupportedErr = null;
const noop = CMF.startVoiceInput({ onError: (c) => (unsupportedErr = c) });
check("unsupported error code", unsupportedErr === "not-supported");
noop.stop();
check("noop stop safe", true);

// Stub recognizer records configuration and lets the test fire events.
let instance = null;
class FakeRecognition {
  constructor() {
    instance = this;
    this.started = false;
    this.stopped = false;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    if (this.onend) this.onend();
  }
}
global.window.webkitSpeechRecognition = FakeRecognition;
check("supported via webkit prefix", CMF.voiceSupported() === true);

const states = [];
let transcript = null;
let errCode = null;
const handle = CMF.startVoiceInput({
  onResult: (t) => (transcript = t),
  onState: (s) => states.push(s),
  onError: (c) => (errCode = c),
});
check("listening state", states[0] === "listening");
check("lang zh-CN", instance.lang === "zh-CN");
check("single final result", instance.interimResults === false && instance.maxAlternatives === 1);
check("started", instance.started === true);

instance.onresult({ results: [[{ transcript: " 我有西红柿和鸡蛋 " }]] });
check("transcript trimmed", transcript === "我有西红柿和鸡蛋");
instance.onresult({ results: [[]] });
check("empty result ignored", transcript === "我有西红柿和鸡蛋");
instance.onerror({ error: "no-speech" });
check("error forwarded", errCode === "no-speech");
handle.stop();
check("stop delegated", instance.stopped === true);
check("idle after end", states[states.length - 1] === "idle");

// start() throwing degrades to an error, not a crash.
global.window.webkitSpeechRecognition = class {
  start() {
    throw new Error("blocked");
  }
};
let startErr = null;
CMF.startVoiceInput({ onError: (c) => (startErr = c) }).stop();
check("start failure surfaced", startErr === "start-failed");

// Standard prefix also works.
delete global.window.webkitSpeechRecognition;
global.window.SpeechRecognition = FakeRecognition;
check("standard prefix supported", CMF.voiceSupported() === true);

if (failures.length) {
  console.error("VOICE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }));