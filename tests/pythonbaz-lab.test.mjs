import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../pyodide-worker.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../pythonbaz-sw.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8");

test("lab runs Python in a dedicated worker and offers stop", () => {
  assert.match(html, /new Worker\(/);
  assert.match(html, /id="stopBtn"/);
  assert.match(html, /id="inputLines"/);
});
test("worker isolates runtime and accepts stdin lines", () => {
  assert.match(worker, /runPythonAsync/);
  assert.match(worker, /setStdin/);
  assert.match(worker, /setStdout/);
  assert.match(worker, /0\.29\.5/);
});
test("service worker caches only pinned Pyodide assets", () => {
  assert.match(sw, /pythonbaz-pyodide-0\.29\.5/);
  assert.match(sw, /pyodide@0\.29\.5/);
});

test("main inline script parses as JavaScript", () => {
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start, "inline application script should exist");
  assert.doesNotThrow(() => new Function(html.slice(start + 8, end)));
});

test("the old main-thread runtime loading path is gone", () => {
  assert.doesNotMatch(html, /window\.loadPyodide/);
  assert.doesNotMatch(html, /pyodide\.runPython\(/);
});

test("worker tries the local copy before any CDN", () => {
  const local = worker.indexOf('name: "local"');
  const cdn = worker.indexOf('name: "cdn"');
  assert.ok(local >= 0 && cdn > local, "local source must be listed first");
  assert.match(worker, /vendor\/pyodide\//);
});

test("service worker precaches the app shell for offline start", () => {
  for (const file of ["./index.html", "./pyodide-worker.js?v=3", "./manifest.webmanifest"]) {
    assert.ok(sw.includes(file), file + " should be precached");
  }
  assert.match(sw, /vendor\/pyodide\//);
});

test("manifest is valid JSON and points to existing files", () => {
  const data = JSON.parse(manifest);
  assert.equal(data.start_url, "./");
  assert.ok(data.icons.length >= 1);
  assert.match(html, /rel="manifest"/);
});

test("page passes a seed and understands the starved flag", () => {
  assert.match(html, /seed:labSession\.seed/);
  assert.match(html, /m\.starved/);
});

/* Behavioural test: run the real worker file against a fake Pyodide. */
function loadWorker({ importScriptsImpl, loadPyodideImpl }) {
  const posted = [];
  const sandbox = {
    URL, TextDecoder, Uint8Array, console,
    postMessage: (m) => posted.push(m),
    importScripts: importScriptsImpl,
    location: { href: "https://example.github.io/pythonbaz/pyodide-worker.js?v=3" },
  };
  sandbox.self = sandbox;
  sandbox.self.loadPyodide = undefined;
  vm.createContext(sandbox);
  vm.runInContext(worker, sandbox);
  sandbox.__loadPyodideImpl = loadPyodideImpl;
  return { sandbox, posted };
}

test("worker falls back to CDN when the local copy is missing", async () => {
  const tried = [];
  const { sandbox, posted } = loadWorker({
    importScriptsImpl(url) {
      tried.push(url);
      if (url.includes("/vendor/pyodide/")) throw new Error("NetworkError: 404");
      sandbox.loadPyodide = async () => ({ fake: true });
    },
  });
  await sandbox.onmessage({ data: { type: "init" } });
  assert.ok(tried[0].includes("/pythonbaz/vendor/pyodide/pyodide.js"), "local first: " + tried[0]);
  assert.ok(tried[1].startsWith("https://cdn.jsdelivr.net/pyodide/v0.29.5/"), "then CDN: " + tried[1]);
  const ready = posted.find((m) => m.type === "ready");
  assert.equal(ready.source, "cdn");
});

test("worker uses the local copy when present", async () => {
  const { sandbox, posted } = loadWorker({
    importScriptsImpl() { sandbox.loadPyodide = async () => ({ fake: true }); },
  });
  await sandbox.onmessage({ data: { type: "init" } });
  assert.equal(posted.find((m) => m.type === "ready").source, "local");
});

test("run: fresh namespace, __main__, seed, and output cut at the starved input()", async () => {
  const calls = { seeds: [], namespaces: [], destroyed: 0 };
  const fakePy = {
    handlers: {},
    setStdout(h) { this.handlers.stdout = h.raw; },
    setStderr(h) { this.handlers.stderr = h.raw; },
    setStdin(h) { this.handlers.stdin = h.stdin; },
    runPython(code) { calls.seeds.push(code); },
    globals: {
      get() {
        return function makeDict() {
          const ns = { values: {}, set(k, v) { this.values[k] = v; }, destroy() { calls.destroyed++; } };
          calls.namespaces.push(ns);
          return ns;
        };
      },
    },
    async runPythonAsync(code, options) {
      const write = (s) => { for (const b of Buffer.from(s, "utf8")) this.handlers.stdout(b); };
      write("name? ");
      const first = this.handlers.stdin();      // answered from the prepared lines
      const second = this.handlers.stdin();     // no more lines -> starved
      write("this must be cut off\n");
      assert.equal(first, "Sara");
      assert.equal(second, null);
      assert.equal(options.globals, calls.namespaces[calls.namespaces.length - 1]);
    },
  };
  const { sandbox, posted } = loadWorker({
    importScriptsImpl() { sandbox.loadPyodide = async () => fakePy; },
  });
  await sandbox.onmessage({ data: { type: "run", id: 7, code: "x", inputs: "Sara\n", seed: 123 } });
  const result = posted.find((m) => m.type === "result");
  assert.equal(result.id, 7);
  assert.equal(result.starved, true);
  assert.equal(result.stdout, "name? ");
  assert.equal(result.error, null);
  assert.match(calls.seeds[0], /random\.seed\(123\)/);
  assert.equal(calls.namespaces[0].values.__name__, "__main__");
  assert.equal(calls.destroyed, 1);
});
