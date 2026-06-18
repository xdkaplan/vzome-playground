import { createSignal, onMount, onCleanup, createEffect, on } from 'solid-js';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { apiCompletions } from './api-completions.js';
import DEFAULT_SCRIPT from '../defaultScript.js?raw';

const xmlToDataUrl = (xml) => {
  const base64 = btoa(unescape(encodeURIComponent(xml)));
  return `data:application/xml;base64,${base64}`;
};

const VIEWER_BG = '#8CC2E7'; // matches the vzome-viewer's rendered background

// The workspace: the CodeMirror editor, the vZome worker, and the
// vzome-viewer, plus the run lifecycle. The host renders <div id="editor">
// (wired via `refEditor`) and the <vzome-viewer> element; this hook creates the
// editor/worker and drives the viewer in onMount.
//
// `getTitle` is read only to name the downloaded mesh file. The methods
// getCode/setCode/getInput/loadInput/resetRunState/captureThumbnail are the
// surface the share module needs to persist and load a sketch.
export function createWorkspace({ getTitle, blankStart = false } = {}) {
  const [errored, setErrored] = createSignal(false); // last run threw — drives the canvas overlay
  const [output, setOutput] = createSignal('');
  const [inputName, setInputName] = createSignal('no input');
  const [running, setRunning] = createSignal(false);
  const [runningDelayed, setRunningDelayed] = createSignal(false); // running() debounced 0.3s — skips the blip on fast runs
  const [engineReady, setEngineReady] = createSignal(false); // vZome engine finished loading in the worker
  const [hasResult, setHasResult] = createSignal(false);
  const [everRun, setEverRun] = createSignal(false); // first Run yet? (one-shot — drives stronger pre-run viewer grain)

  let editorEl;
  let editor;
  let viewer;
  let worker;
  let currentInput = null;
  let lastMesh = null;
  let templateXml = null;
  let templateDataUrl = null;
  const refEditor = (el) => { editorEl = el; };

  // The message floated over the canvas; null once a result renders (overlay hidden).
  // Show "Running…" only if the run outlasts 0.3s; clear instantly when it ends.
  createEffect(on(running, (isRunning) => {
    if (!isRunning) { setRunningDelayed(false); return; }
    const t = setTimeout(() => setRunningDelayed(true), 300);
    onCleanup(() => clearTimeout(t));
  }));

  const overlayState = () => {
    if (hasResult()) return null;
    if (running()) return !engineReady() ? 'loading' : (runningDelayed() ? 'running' : null);
    if (errored()) return 'error';
    return null; // idle: no prompt over the canvas (the Run button affords it)
  };

  onMount(async () => {
    editor = new EditorView({
      doc: blankStart ? '' : DEFAULT_SCRIPT, // shared-link load starts blank; loadSketch fills it in
      extensions: [basicSetup, javascript(), apiCompletions],
      parent: editorEl,
    });
    viewer = document.querySelector('vzome-viewer'); // element ref; upgrades once its module loads

    // Engine worker first so it loads in parallel — it's the long pole.
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'ENGINE_READY') { setEngineReady(true); return; }
      setRunning(false);
      if (type === 'SCRIPT_RESULT') {
        lastMesh = payload.mesh;

        const doc = new DOMParser().parseFromString(templateXml, 'application/xml');
        doc.querySelector('ImportSimpleMeshJson').textContent = payload.mesh;
        viewer.src = xmlToDataUrl(new XMLSerializer().serializeToString(doc));

        // The success readout used to live in the status bar; now it tails the console.
        const done = `Done — ${payload.edges} edges (engine: ${payload.engine}).`;
        setOutput([...payload.logs, done].join('\n'));
        setHasResult(true);
        setErrored(false);
      } else if (type === 'SCRIPT_ERROR') {
        const logBlock = payload.logs.length ? payload.logs.join('\n') + '\n\n' : '';
        setOutput(logBlock + (payload.stack || payload.message));
        setHasResult(false);
        setErrored(true);
      }
    };

    // The vzome-viewer web component is heavy (Three.js); load it on demand so it
    // no longer gates first paint (it was a static import). Fetch the template in
    // parallel, then show it once the viewer's custom element is defined.
    const templateText = fetch('/template.vZome').then((r) => r.text());
    await import('https://www.vzome.com/modules/vzome-viewer.js');
    await customElements.whenDefined('vzome-viewer');
    templateXml = await templateText;
    templateDataUrl = xmlToDataUrl(templateXml);
    viewer.src = templateDataUrl;
  });

  const run = () => {
    if (!worker) return; // worker is created in onMount; ignore clicks before it's ready
    setEverRun(true); // one-shot: drop the stronger pre-run viewer grain
    setOutput('');
    setRunning(true);
    setHasResult(false);
    setErrored(false);
    lastMesh = null;
    worker.postMessage({
      type: 'RUN_SCRIPT',
      payload: { code: editor.state.doc.toString(), input: currentInput },
    });
  };

  const onFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    currentInput = { name: file.name, text: await file.text() };
    setInputName(file.name);
  };

  // lastMesh is the engine's mesh JSON as a string; pretty-print it for export.
  const prettyMesh = () => {
    try { return JSON.stringify(JSON.parse(lastMesh), null, 2); } catch { return lastMesh; }
  };

  // Title → safe filename: drop characters illegal in filenames, collapse
  // whitespace to hyphens, trim stray separators; fall back to "mesh".
  const meshFilename = () => {
    const name = (getTitle?.() || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
    return `${name || 'mesh'}.json`;
  };

  const download = () => {
    if (!lastMesh) return;
    const blob = new Blob([prettyMesh()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = meshFilename();
    a.click();
    URL.revokeObjectURL(url);
  };

  // Capture the viewer and composite it onto a 1200x630 OG card: the model is
  // contain-fit and centered, with the rest filled in the viewer's own blue so
  // the padding is seamless. Returns base64 WebP (PNG on old Safari; no data: prefix) or null.
  const captureThumbnail = async () => {
    try {
      const bmp = await createImageBitmap(await viewer.captureImage());

      // The viewer frames the model small in a sea of blue, so crop to the
      // model's bounding box (pixels differing from the corner/background)
      // before fitting — otherwise the card looks zoomed out.
      const scratch = document.createElement('canvas');
      scratch.width = bmp.width;
      scratch.height = bmp.height;
      const sctx = scratch.getContext('2d');
      sctx.drawImage(bmp, 0, 0);
      const { data } = sctx.getImageData(0, 0, bmp.width, bmp.height);
      const bg = [data[0], data[1], data[2]];
      let minX = bmp.width, minY = bmp.height, maxX = -1, maxY = -1;
      for (let y = 0; y < bmp.height; y++) {
        for (let x = 0; x < bmp.width; x++) {
          const i = (y * bmp.width + x) * 4;
          const diff = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
          if (diff > 40) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
      if (maxX >= minX && maxY >= minY) {
        const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.07);
        sx = Math.max(0, minX - pad);
        sy = Math.max(0, minY - pad);
        sw = Math.min(bmp.width - sx, maxX - minX + 1 + 2 * pad);
        sh = Math.min(bmp.height - sy, maxY - minY + 1 + 2 * pad);
      }

      const W = 1200, H = 630, SQ = 630;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = VIEWER_BG;
      ctx.fillRect(0, 0, W, H);
      const scale = Math.min(SQ / sw, SQ / sh);
      const dw = sw * scale, dh = sh * scale;
      ctx.drawImage(bmp, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.5));
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onloadend = () => res(String(r.result));
        r.readAsDataURL(blob);
      });
      return dataUrl.split(',')[1] || null; // strip "data:image/png;base64,"
    } catch {
      return null;
    }
  };

  // ── Surface used by other modules ──────────────────────────────────────────
  const getCode = () => editor.state.doc.toString();
  const setCode = (code) =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
  const getInput = () => currentInput;
  const loadInput = (input) => {
    currentInput = input ?? null;
    if (input?.name) setInputName(input.name);
  };
  const resetRunState = () => {
    setHasResult(false); // fresh sketch — show the idle prompt over the canvas until Run
    setErrored(false);
    setRunning(false); // defensive: don't leave the overlay stuck if a run was in flight
  };
  const measure = () => editor?.requestMeasure?.();

  return {
    // run-state read by the JSX
    running, hasResult, everRun, output, overlayState, inputName,
    // actions / refs for the JSX
    run, download, onFileChange, refEditor,
    // for the pane layout
    measure,
    // for the share module
    getCode, setCode, getInput, loadInput, resetRunState, captureThumbnail,
  };
}
