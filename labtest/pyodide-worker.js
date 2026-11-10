/* PythonBaz Lab worker — isolates Pyodide from the page UI. */
const VERSION = "0.29.5";
const CDN = [
  { script: `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/pyodide.js`, base: `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/` },
  { script: `https://cdn.jsdelivr.net/npm/pyodide@${VERSION}/pyodide.js`, base: `https://cdn.jsdelivr.net/npm/pyodide@${VERSION}/` }
];
let runtime = null;
let initPromise = null;

async function initialize() {
  if (runtime) return runtime;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let lastError = null;
    for (const cdn of CDN) {
      try {
        self.postMessage({ type: "progress", message: "در حال بارگیری موتور پایتون (نسخه " + VERSION + ")…" });
        if (typeof self.loadPyodide !== "function") importScripts(cdn.script);
        const instance = await self.loadPyodide({ indexURL: cdn.base });
        runtime = instance;
        self.postMessage({ type: "ready", version: VERSION });
        return runtime;
      } catch (error) {
        lastError = error;
        self.loadPyodide = undefined;
      }
    }
    throw new Error("بارگیری موتور پایتون از دو مسیر ناموفق بود. اینترنت، فیلترشکن یا محدودیت CDN را بررسی کنید. " + String(lastError || ""));
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
  try {
    const py = await initialize();
    const lines = String(message.inputs || "").replace(/\r/g, "").split("\n");
    let inputIndex = 0;
    py.setStdout({ batched: (text) => { stdout += text; } });
    py.setStderr({ batched: (text) => { stderr += text; } });
    py.setStdin({ stdin: () => inputIndex < lines.length ? lines[inputIndex++] : null });
    await py.runPythonAsync(String(message.code || ""));
    self.postMessage({ type: "result", id, stdout, stderr, error: null });
  } catch (error) {
    self.postMessage({ type: "result", id, stdout, stderr, error: String(error) });
  }
};
