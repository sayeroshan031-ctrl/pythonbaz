# PythonBaz Lab v3

## What changed

- Python executes in a dedicated Web Worker, not on the UI thread.
- A runaway loop can be stopped immediately; a per-run timeout also terminates the worker.
- The runtime uses a pinned Pyodide 0.29.5 build with two CDN paths.
- A service worker caches Pyodide assets after a successful download. Offline use is best-effort and depends on a successful first download and browser cache retention.
- `input()` works two ways: prefilled input lines (one answer per line), and live prompt-by-prompt answers — when the prefilled lines run out, the run pauses, shows the prompt in the output and asks the user for the next answer inline in the console (implemented as a fast replay with the answers collected so far).
- The lab code and stdin draft are saved locally in the current browser.
- The existing Persian learning course, missions, flashcards, quiz, project examples, progress and score pages remain intact.

## User test

Open the GitHub Pages app, go to Lab, wait for the first runtime download, then test:

```python
name = input("Your name: ")
print("Hello", name)
```

Enter one line (e.g. `Sara`) in the input area before running. Also test a long loop and use Stop.

## Limits

Pyodide is a browser/WebAssembly Python environment, not full CPython. It does not provide arbitrary OS access or all native packages. First-time use requires internet access to download the runtime. This project is static and does not host the large Pyodide runtime binary itself.
