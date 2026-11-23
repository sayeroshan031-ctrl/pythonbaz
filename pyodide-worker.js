/* PythonBaz Lab worker v4 — isolates Pyodide from the page UI. */
/* © 2026 Mohammadreza Hosseinzadeh (محمدرضا حسین‌زاده). All rights reserved. */
const VERSION = "0.29.5";

/* Local copy first (served from the site itself, see README-offline.md),
   then the CDN. The local copy is what makes the lab work without a VPN
   and, together with the service worker, offline. */
const LOCAL_BASE = new URL("./vendor/pyodide/", self.location.href).href;
const SOURCES = [
  { name: "local", script: LOCAL_BASE + "pyodide.js", base: LOCAL_BASE },
  { name: "cdn", script: `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/pyodide.js`, base: `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/` },
  { name: "cdn", script: `https://cdn.jsdelivr.net/npm/pyodide@${VERSION}/pyodide.js`, base: `https://cdn.jsdelivr.net/npm/pyodide@${VERSION}/` }
];
let runtime = null;
let runtimeSource = null;
let initPromise = null;

async function initialize() {
  if (runtime) return runtime;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const failures = [];
    for (const source of SOURCES) {
      try {
        self.postMessage({
          type: "progress",
          message: source.name === "local"
            ? "در حال بارگیری موتور پایتون از فایل‌های خود سایت (نسخه " + VERSION + ")…"
            : "در حال بارگیری موتور پایتون از CDN (نسخه " + VERSION + ")…"
        });
        if (typeof self.loadPyodide !== "function") importScripts(source.script);
        const instance = await self.loadPyodide({ indexURL: source.base });
        runtime = instance;
        runtimeSource = source.name;
        self.postMessage({ type: "ready", version: VERSION, source: source.name });
        return runtime;
      } catch (error) {
        failures.push(source.name + ": " + String(error));
        self.loadPyodide = undefined;
      }
    }
    throw new Error(
      "بارگیری موتور پایتون ناموفق بود (فایل محلی و هر دو مسیر CDN). " +
      "اگر اولین بار است، یک بار با اینترنت باز کن تا موتور در مرورگر ذخیره شود. " +
      failures.join(" | ")
    );
  })();
  try { return await initPromise; }
  finally { initPromise = null; }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "init") {
    try { await initialize(); }
    catch (error) { self.postMessage({ type: "init-error", error: String(error) }); }
    return;
  }
  if (message.type !== "run") return;
  const id = message.id;
  let stdout = "";
  let stderr = "";
  let starved = false;
  let starvedAt = 0;
  let namespace = null;
  const finish = (error) => {
    /* When the program asked for more input than we have, everything it
       printed after that question is meaningless (it will be re-run with the
       answer), so cut the output exactly at the question. */
    if (starved) stdout = stdout.slice(0, starvedAt);
    self.postMessage({ type: "result", id, stdout, stderr, error, starved });
  };
  try {
    const py = await initialize();
    const rawInputs = String(message.inputs || "").replace(/\r/g, "");
    const lines = rawInputs === "" ? [] : rawInputs.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    let inputIndex = 0;
    const stdoutDecoder = new TextDecoder("utf-8");
    const stderrDecoder = new TextDecoder("utf-8");
    py.setStdout({ raw: (byte) => { stdout += stdoutDecoder.decode(new Uint8Array([byte]), { stream: true }); } });
    py.setStderr({ raw: (byte) => { stderr += stderrDecoder.decode(new Uint8Array([byte]), { stream: true }); } });
    py.setStdin({
      stdin: () => {
        if (inputIndex < lines.length) return lines[inputIndex++];
        if (!starved) { starved = true; starvedAt = stdout.length; }
        return null;
      }
    });
    /* The page re-runs the whole program to feed live answers to input().
       A fixed seed per session keeps random() based games identical on every
       re-run. Seeding happens in a separate namespace so the learner's own
       namespace stays clean (no hidden "import random"). */
    if (Number.isInteger(message.seed)) {
      py.runPython("import random\nrandom.seed(" + message.seed + ")");
    }
    /* Fresh namespace for every run: classes, functions and variables from a
       previous run never leak into this one, and "__main__" checks work. */
    namespace = py.globals.get("dict")();
    namespace.set("__name__", "__main__");
    await py.runPythonAsync(String(message.code || ""), { globals: namespace });
    finish(null);
  } catch (error) {
    finish(String(error));
  } finally {
    try { if (namespace) namespace.destroy(); } catch (_) {}
  }
};
