import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../pyodide-worker.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../pythonbaz-sw.js", import.meta.url), "utf8");

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
test("the old main-thread runtime loading path is gone", () => {
  assert.doesNotMatch(html, /window\.loadPyodide/);
  assert.doesNotMatch(html, /pyodide\.runPython\(/);
});
