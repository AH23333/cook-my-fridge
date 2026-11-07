/* Hands-free ingredient input via the browser-native Web Speech API.
   No network service of our own: recognition is provided by the browser.
   Unsupported browsers simply hide the microphone button. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function RecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  CMF.voiceSupported = function () {
    return !!RecognitionCtor();
  };

  /* Returns {stop}. Callbacks: onResult(transcript), onState("listening" |
     "idle"), onError(code). All DOM work stays in the page script. */
  CMF.startVoiceInput = function (handlers) {
    const h = handlers || {};
    const Ctor = RecognitionCtor();
    if (!Ctor) {
      if (h.onError) h.onError("not-supported");
      return { stop() {} };
    }
    const rec = new Ctor();
    rec.lang = h.lang || "zh-CN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript =
        ev && ev.results && ev.results[0] && ev.results[0][0]
          ? String(ev.results[0][0].transcript || "").trim()
          : "";
      if (transcript && h.onResult) h.onResult(transcript);
    };
    rec.onerror = (ev) => {
      if (h.onError) h.onError(ev && ev.error ? ev.error : "unknown");
    };
    rec.onend = () => {
      if (h.onState) h.onState("idle");
    };
    try {
      rec.start();
      if (h.onState) h.onState("listening");
    } catch (e) {
      if (h.onError) h.onError("start-failed");
      return { stop() {} };
    }
    return {
      stop() {
        try {
          rec.stop();
        } catch (e) {
          /* already ended */
        }
      },
    };
  };
})();