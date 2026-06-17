import { render } from 'solid-js/web';
import { createSignal, onMount, onCleanup, Show, For, createEffect, on } from 'solid-js';
import Button from '@suid/material/Button';
import Dialog from '@suid/material/Dialog';
import DialogTitle from '@suid/material/DialogTitle';
import DialogContent from '@suid/material/DialogContent';
import DialogActions from '@suid/material/DialogActions';
import Checkbox from '@suid/material/Checkbox';
import FormControlLabel from '@suid/material/FormControlLabel';
import { generateSlugParts, slugFromParts, prettySlug } from './playground/slug.js';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { apiCompletions } from './playground/api-completions.js';

import DEFAULT_SCRIPT from './defaultScript.js?raw';
import DEFAULT_DESCRIPTION from './docs/default-description.md?raw';
import { createAuroraGridGL } from './aurora.js';
import { Gallery } from './Gallery.jsx';
const TEMPLATE_VZOME = '/template.vZome';

import 'https://www.vzome.com/modules/vzome-viewer.js';

import './style.css';

// The first markdown heading in a description becomes the sketch's title.
function titleFromDescription(md) {
  const m = (md || '').match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

const xmlToDataUrl = (xml) => {
  const base64 = btoa(unescape(encodeURIComponent(xml)));
  return `data:application/xml;base64,${base64}`;
};

// Hard cap on the sketch name at input time — a Fibonacci number.
const TITLE_MAX = 55;

// A description = a title (first markdown heading) + a body (the rest). We edit
// them separately (title in the header, body in the WYSIWYG) and recombine to
// one markdown string for storage.
function bodyFromDescription(md) {
  const lines = (md || '').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^#{1,6}\s+/.test(lines[i].trim())) i++; // drop heading
  while (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n');
}

function composeDescription(title, body) {
  const t = (title || '').trim();
  const b = (body || '').trim();
  return (t ? `# ${t}\n\n` : '') + b;
}

const DEFAULT_TITLE = titleFromDescription(DEFAULT_DESCRIPTION);
const DEFAULT_BODY = bodyFromDescription(DEFAULT_DESCRIPTION);

// Max length for the plain-text description body — a Fibonacci number (golden).
const MAX_BODY = 610;

function Playground() {
  const [errored, setErrored] = createSignal(false); // last run threw — drives the canvas overlay
  const [notice, setNotice] = createSignal(null); // OK-modal message (shared-link load failures)
  const [output, setOutput] = createSignal('');
  const [inputName, setInputName] = createSignal('no input');
  const [running, setRunning] = createSignal(false);
  const [runningDelayed, setRunningDelayed] = createSignal(false); // running() debounced 0.3s — skips the blip on fast runs
  const [engineReady, setEngineReady] = createSignal(false); // vZome engine finished loading in the worker
  const [hasResult, setHasResult] = createSignal(false);
  const [everRun, setEverRun] = createSignal(false); // first Run yet? (one-shot — drives stronger pre-run viewer grain)
  const [docsOpen, setDocsOpen] = createSignal(true);
  const [codeOpen, setCodeOpen] = createSignal(true);
  const [viewOpen, setViewOpen] = createSignal(true);
  const [mobile, setMobile] = createSignal(false); // narrow window: flip/flop one pane at a time
  let mainEl;
  let viewAutoCollapsed = false; // true when the window (not a drag) collapsed the 3D pane
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareStep, setShareStep] = createSignal('choose');
  const [shareError, setShareError] = createSignal(null); // inline publish failure in the Share dialog
  const [parts, setParts] = createSignal({ words: [], suffix: '' });
  const [showInGallery, setShowInGallery] = createSignal(true);
  const [copied, setCopied] = createSignal(false);
  const [title, setTitle] = createSignal(DEFAULT_TITLE);
  const [body, setBody] = createSignal(DEFAULT_BODY);
  const [editingDoc, setEditingDoc] = createSignal(false);
  const [runPulse, setRunPulse] = createSignal(false); // brief on-load aurora+glow affordance on the Run button
  const DEFAULT_CODE_W = 620; // default editor pane width (double-click the divider to reset)
  const [codeW, setCodeW] = createSignal(DEFAULT_CODE_W); // editor pane width; viewer takes the rest
  let restoreCodeW = DEFAULT_CODE_W; // width to pop back to after a drag collapses the code pane

  // Drag the divider between the code editor and the viewer. Dragging the code
  // pane below COLLAPSE_AT snaps it shut into a "CODE" gutter; dragging so the
  // viewer drops below VIEW_COLLAPSE_AT snaps the viewer into a "3D" gutter.
  const COLLAPSE_AT = 54;
  const VIEW_COLLAPSE_AT = 160;
  const DIVIDER_W = 8;
  const MOBILE_AT = 768; // below this the panes flip/flop one at a time (tablet-portrait boundary)
  const startDragCode = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = codeW();
    restoreCodeW = startW;
    const main = e.currentTarget.parentElement;
    const onMove = (ev) => {
      const next = startW + ev.clientX - startX;
      const viewerW = main.clientWidth - next - DIVIDER_W;
      if (next < COLLAPSE_AT) {
        setCodeOpen(false);
      } else if (viewerW < VIEW_COLLAPSE_AT) {
        setViewOpen(false);
        viewAutoCollapsed = false;        // this was a deliberate drag
        setCodeW(startW);                 // keep the pre-drag width for restore
      } else {
        setCodeOpen(true);
        setViewOpen(true);
        setCodeW(next);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetDivider = () => {
    setCodeOpen(true);
    setViewOpen(true);
    viewAutoCollapsed = false;
    setCodeW(DEFAULT_CODE_W);
    requestAnimationFrame(() => editor?.requestMeasure?.());
  };

  const restoreCode = () => {
    setCodeW(restoreCodeW);
    setCodeOpen(true);
    if (mobile()) setViewOpen(false); // mobile flip: showing code hides 3D into its gutter
    requestAnimationFrame(() => editor?.requestMeasure?.());
  };

  const restoreView = () => {
    setViewOpen(true);
    if (mobile()) {
      setCodeOpen(false); // mobile flip: showing 3D hides code into its gutter
    } else if (mainEl) {
      // shrink code so the viewer has room; otherwise the next ResizeObserver
      // tick (reflow) would immediately auto-collapse the 3D pane again.
      const maxCode = mainEl.clientWidth - DIVIDER_W - VIEW_COLLAPSE_AT;
      if (codeW() > maxCode) setCodeW(Math.max(COLLAPSE_AT, maxCode));
    }
    viewAutoCollapsed = false;
    // nudge the vzome-viewer to re-measure its canvas (does NOT drive reflow).
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };

  // Keep the layout sane as the window resizes. Below MOBILE_AT, only one of
  // Code/3D shows at a time (flip/flop). Above it, the 3D pane auto-collapses
  // when it would get too narrow (and re-opens when there's room again, unless
  // it was collapsed by hand).
  const reflow = () => {
    if (!mainEl) return;
    const w = mainEl.clientWidth;
    const nowMobile = w < MOBILE_AT;
    const wasMobile = mobile();
    if (nowMobile !== wasMobile) setMobile(nowMobile);

    if (nowMobile) {
      // exactly one pane open — default to the 3D view with the code guttered
      if (codeOpen() && viewOpen()) setCodeOpen(false);
      else if (!codeOpen() && !viewOpen()) setViewOpen(true);
      viewAutoCollapsed = false;
      return;
    }

    // leaving mobile -> show both, then let the responsive check below run
    if (wasMobile) {
      setCodeOpen(true);
      setViewOpen(true);
      viewAutoCollapsed = false;
    }

    if (!codeOpen()) return; // code is the gutter; leave the viewer alone
    const viewerW = w - codeW() - DIVIDER_W;
    if (viewOpen() && viewerW < VIEW_COLLAPSE_AT) {
      setViewOpen(false);
      viewAutoCollapsed = true;
    } else if (!viewOpen() && viewAutoCollapsed && viewerW >= VIEW_COLLAPSE_AT) {
      setViewOpen(true);
      viewAutoCollapsed = false;
    }
  };

  // Editing from a collapsed description expands it; Finish returns it to
  // whatever fold state it was in before.
  let docsWasCollapsed = false;
  const startEditDoc = () => {
    docsWasCollapsed = !docsOpen();
    setDocsOpen(true);
    setEditingDoc(true);
  };
  const finishEditDoc = () => {
    setEditingDoc(false);
    if (docsWasCollapsed) setDocsOpen(false);
  };

  const words = () => parts().words;
  const shareUrl = () => `${location.origin}/s/${slugFromParts(parts())}`;

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

  let editorEl;
  let canvasEl;
  let fileInput;
  let editor;
  let viewer;
  let worker;
  let currentInput = null;
  let lastMesh = null;
  let templateXml = null;
  let templateDataUrl = null;
  // Snapshot of the content the moment it was last published or loaded (code +
  // title + body + slug parts). If the current content still matches, the sketch
  // is already online and Share can jump straight to the link.
  let published = null;
  const partsFromSlug = (slug) => { const a = slug.split('-'); return { words: a.slice(0, -1), suffix: a.at(-1) }; };
  const isUnchanged = () =>
    published &&
    editor.state.doc.toString() === published.code &&
    title() === published.title &&
    body() === published.body;

  // Responsive layout observer — set up synchronously so onCleanup registers in
  // the reactive root (avoids leaking/duplicating observers across HMR).
  onMount(() => {
    if (!mainEl) return;
    reflow();
    const ro = new ResizeObserver(reflow);
    ro.observe(mainEl);
    onCleanup(() => ro.disconnect());
  });

  onMount(async () => {
    editor = new EditorView({
      doc: DEFAULT_SCRIPT,
      extensions: [basicSetup, javascript(), apiCompletions],
      parent: editorEl,
    });
    viewer = document.querySelector('vzome-viewer');

    templateXml = await (await fetch('/template.vZome')).text();
    templateDataUrl = xmlToDataUrl(templateXml);
    viewer.src = templateDataUrl;

    worker = new Worker(new URL('./playground/worker.js', import.meta.url), { type: 'module' });
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

    const shared = location.pathname.match(/^\/s\/(.+)$/);
    if (shared) loadSketch(decodeURIComponent(shared[1]));
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

  // On-load affordance: 1s after load, bloom a fast-breathing aurora inside the
  // Run button (with a wide glow) for 3s to signal Run is the only next step.
  let runAuroraCanvas, runAuroraCtl;
  const RUN_AURORA = {
    res: 48,
    maxFps: 30,
    hover: {
      duration: 0.3,
      from: { blobStrength: 0.18, hueSpread: 0.8 },
      to: { blobStrength: 0.55, hueSpread: 3.0 },
      breath: { rate: 0.31 * 1.5 * 1.3, amount: { blobStrength: 0.2, hueSpread: 1.2 } }, // 1.5× normal, then +30%
    },
  };
  createEffect(on(runPulse, (on) => {
    runAuroraCtl?.destroy();
    runAuroraCtl = undefined;
    if (!on) return; // off → leave the last frame to fade out via CSS opacity
    queueMicrotask(() => {
      if (!runAuroraCanvas) return;
      try {
        // bloom much more severe on mobile (the play-fab shows it most prominently): 30%, +40%, +30%
        const to = RUN_AURORA.hover.to;
        const m = 1.3 * 1.4 * 1.3;
        const opts = mobile()
          ? { ...RUN_AURORA, hover: { ...RUN_AURORA.hover, to: { blobStrength: to.blobStrength * m, hueSpread: to.hueSpread * m } } }
          : RUN_AURORA;
        runAuroraCtl = createAuroraGridGL([runAuroraCanvas], [{ seed: 3 }], opts);
        runAuroraCtl.setHover(0, true); // bloom + breathe
      } catch { /* no WebGL2 — the glow still draws attention */ }
    });
  }));
  onMount(() => {
    const t1 = setTimeout(() => setRunPulse(true), 1000);
    const t2 = setTimeout(() => setRunPulse(false), 4000); // 1s delay + 3s on screen
    onCleanup(() => { clearTimeout(t1); clearTimeout(t2); });
  });
  onCleanup(() => runAuroraCtl?.destroy());

  // lastMesh is the engine's mesh JSON as a string; pretty-print it for export.
  const prettyMesh = () => {
    try { return JSON.stringify(JSON.parse(lastMesh), null, 2); } catch { return lastMesh; }
  };

  // Title → safe filename: drop characters illegal in filenames, collapse
  // whitespace to hyphens, trim stray separators; fall back to "mesh".
  const meshFilename = () => {
    const name = (title() || '')
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
  // the padding is seamless. Returns base64 PNG (no data: prefix) or null.
  const VIEWER_BG = '#8CC2E7'; // matches the vzome-viewer's rendered background
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
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
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

  const openShare = () => {
    setCopied(false);
    setShareError(null);
    if (isUnchanged()) {
      // unchanged since it was published/loaded → already online; show its link
      setParts(published.parts);
      setShareStep('link');
    } else {
      setParts(generateSlugParts());
      setShowInGallery(true);
      setShareStep('choose');
    }
    setShareOpen(true);
  };

  const reroll = () => setParts(generateSlugParts());

  // Persist the sketch (code + description + input) and reveal the link.
  // The mesh is not stored — loading a sketch requires pressing Run.
  const commit = async () => {
    setCopied(false);
    setShareError(null);
    try {
      const image = hasResult() ? await captureThumbnail() : null;
      const res = await fetch('/api/sketch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slugFromParts(parts()),
          code: editor.state.doc.toString(),
          description: composeDescription(title(), body()),
          title: title(),
          input: currentInput,
          public: showInGallery(),
          image,
        }),
      });
      if (res.status === 413) { setNotice('Your script is longer than the server allows.'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      published = { code: editor.state.doc.toString(), title: title(), body: body(), parts: parts() };
      setShareStep('link');
    } catch (e) {
      setShareError('Publish failed: ' + e.message + ' (backend running?)');
    }
  };

  const loadSketch = async (slug) => {
    const key = slug.toLowerCase(); // slugs are stored lowercase — case-insensitive load
    const pretty = prettySlug(key);
    try {
      const res = await fetch('/api/sketch/' + encodeURIComponent(key));
      if (!res.ok) {
        setNotice(`Sketch not found: "${pretty}"`);
        return;
      }
      const sk = await res.json();
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: sk.code } });
      const desc = sk.description || DEFAULT_DESCRIPTION;
      setTitle(titleFromDescription(desc) || pretty);
      setBody(bodyFromDescription(desc));
      setEditingDoc(false);
      document.title = (titleFromDescription(desc) || pretty) + ' — vZome Playground';
      currentInput = sk.input ?? null;
      if (sk.input?.name) setInputName(sk.input.name);
      setHasResult(false); // fresh sketch — show the idle prompt over the canvas until Run
      setErrored(false);
      setRunning(false); // defensive: don't leave the overlay stuck if a run was in flight
      // it's already online at this slug — Share can link straight to it until edited
      published = { code: sk.code, title: titleFromDescription(desc) || pretty, body: bodyFromDescription(desc), parts: partsFromSlug(key) };
    } catch (e) {
      setNotice('Load error: ' + e.message);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
    } catch {
      /* clipboard can be blocked in some contexts; still confirm the click */
    }
    setCopied(true);
  };

  return (
    <>
      <header>
        <div class="brand">
          <a class="brand-link" href="/gallery"><img class="logo" src="/vzome-logo.svg" alt="vZome" /></a>
          <a class="brand-link" href="/gallery"><h1>vZome Playground</h1></a>
          <span class="spacer" />
        </div>
        <div class="toolbar">
          <Button variant="outlined" size="small" onClick={() => fileInput.click()}>
            {mobile() ? 'Input' : 'Select input…'}
          </Button>
          <input type="file" ref={fileInput} hidden onChange={onFileChange} />
          <Show when={!mobile()}><span class="muted">{inputName()}</span></Show>
          <span class="spacer" />
          <span class="run-affordance" classList={{ pulsing: runPulse() }}>
            <canvas class="run-aurora" width="64" height="64" ref={(el) => (runAuroraCanvas = el)} />
            <Show when={mobile()} fallback={
              <Button variant="outlined" size="small" onClick={run} disabled={running()}>Run ▶</Button>
            }>
              <button class="play-fab" onClick={run} disabled={running()} title="Run">
                <svg viewBox="0 0 122.88 122.88" xmlns="http://www.w3.org/2000/svg" aria-label="Run">
                  <path class="play-circle" fill-rule="evenodd" clip-rule="evenodd" fill="#0387af" d="M61.44,0c33.93,0,61.44,27.51,61.44,61.44s-27.51,61.44-61.44,61.44S0,95.37,0,61.44S27.51,0,61.44,0L61.44,0 L61.44,0z" />
                  <path class="play-triangle" fill-rule="evenodd" clip-rule="evenodd" fill="#FFFFFF" d="M84.32,65.41c3.31-2.13,3.3-4.51,0-6.4L50.13,39.36c-2.7-1.69-5.51-0.7-5.43,2.82l0.11,39.7 c0.23,3.82,2.41,4.86,5.62,3.1L84.32,65.41L84.32,65.41L84.32,65.41z" />
                </svg>
              </button>
            </Show>
          </span>
          <Show when={mobile()} fallback={
            <Button class="share-action" variant="outlined" size="small" onClick={openShare}>Share</Button>
          }>
            <button class="icon-btn share-action" onClick={openShare} title="Share">
              <img src="/share-icon.svg" alt="Share" />
            </button>
          </Show>
          <Show when={mobile()} fallback={
            <Button class="download-action" variant="outlined" size="small" onClick={download} disabled={!hasResult()}>Download</Button>
          }>
            <button class="icon-btn download-action" onClick={download} disabled={!hasResult()} title="Download">
              <img src="/download-icon.svg" alt="Download" />
            </button>
          </Show>
          <Show when={mobile()} fallback={
            <Button class="gallery-action" variant="outlined" size="small" href="/gallery" onClick={() => (location.href = '/gallery')}>Gallery</Button>
          }>
            <a class="icon-btn gallery-action" href="/gallery" title="Gallery">
              <img src="/gallery-icon.svg" alt="Gallery" />
            </a>
          </Show>
        </div>
      </header>
      <main ref={mainEl}>
        <section
          id="editor-pane"
          classList={{ collapsed: !codeOpen(), fill: codeOpen() && !viewOpen() }}
          style={codeOpen() && viewOpen() ? { 'flex-basis': `${codeW()}px` } : undefined}
        >
          <button class="code-tab" onClick={restoreCode} title="Show code">
            <img src="/code-icon.svg" alt="" />
            <span class="code-tab-label">Code</span>
          </button>
          <aside id="docs-pane" classList={{ collapsed: !docsOpen() }}>
            <div class="docs-header">
              <Show
                when={editingDoc()}
                fallback={<span class="docs-title">{title()}</span>}
              >
                <div class="docs-title-field">
                  <input
                    class="docs-title-input"
                    value={title()}
                    placeholder="Title"
                    maxlength={TITLE_MAX}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                  />
                  <span class="docs-title-count">{title().length}/{TITLE_MAX}</span>
                </div>
              </Show>
              <Show
                when={editingDoc()}
                fallback={
                  <button
                    class="icon-btn docs-edit-toggle"
                    onClick={startEditDoc}
                    title="Edit description"
                  >
                    <img src="/pencil-edit.svg" alt="Edit" />
                  </button>
                }
              >
                <Button variant="outlined" size="small" onClick={finishEditDoc}>
                  Finish
                </Button>
              </Show>
              <button
                class="icon-btn docs-collapse"
                onClick={() => setDocsOpen((v) => !v)}
                title={docsOpen() ? 'Hide description' : 'Show description'}
              >
                <img src={docsOpen() ? '/sidebar-collapse.svg' : '/sidebar-expand.svg'} alt="Toggle description" />
              </button>
            </div>
            <Show when={docsOpen()}>
              <Show
                when={editingDoc()}
                fallback={<div class="docs-body">{body()}</div>}
              >
                <textarea
                  class="docs-edit"
                  value={body()}
                  maxlength={MAX_BODY}
                  placeholder="Describe your sketch…"
                  onInput={(e) => setBody(e.currentTarget.value)}
                />
                <div class="docs-charcount">{body().length} / {MAX_BODY}</div>
              </Show>
            </Show>
          </aside>
          <div id="editor" ref={editorEl} />
        </section>
        <Show when={codeOpen() && viewOpen() && !mobile()}>
          <div class="pane-divider" onPointerDown={startDragCode} onDblClick={resetDivider} title="Drag to resize · double-click to reset" />
        </Show>
        <section id="output-pane" classList={{ collapsed: !viewOpen() }}>
          <button class="view-tab" onClick={restoreView} title="Show 3D">
            <img src="/3d-cube.svg" alt="" />
            <span class="view-tab-label">3D</span>
          </button>
          <div class="viewer-wrap" classList={{ 'pre-run': !everRun() }}>
            <vzome-viewer id="viewer" preview={false}> </vzome-viewer>
            <Show when={overlayState()}>
              <div class="canvas-overlay">
                <div class="canvas-overlay-card" classList={{ error: overlayState() === 'error' }}>
                  {overlayState() === 'loading' ? 'Loading vZome…'
                    : overlayState() === 'running' ? 'Running…'
                    : 'Run Failed'}
                </div>
              </div>
            </Show>
          </div>
          <pre id="output">{output()}</pre>
        </section>
      </main>

      <Dialog open={shareOpen()} onClose={() => setShareOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Share</DialogTitle>
        <DialogContent class="share-content">
          <div class="share-subheader">
            {shareStep() === 'choose' ? 'Choose your characters' : 'Your link is live'}
          </div>
          <Show when={shareStep() === 'choose'}>
            <div class="share-words-row" classList={{ stacked: mobile() }}>
              <Button
                class="reroll-btn"
                variant="outlined"
                size="small"
                startIcon={<span class="reroll-glyph">⟳</span>}
                onClick={reroll}
              >
                Reroll
              </Button>
              <div class="slug-word">{words()[0]}</div>
              <div class="slug-word">{words()[1]}</div>
              <div class="slug-word">{words()[2]}</div>
            </div>
            <div class="gallery-toggle">
              <FormControlLabel
                labelPlacement="start"
                control={<Checkbox checked={showInGallery()} onChange={(_, v) => setShowInGallery(v)} />}
                label="Show in Gallery"
              />
            </div>
          </Show>
          <Show when={shareStep() === 'link'}>
            <div class="share-link-row">
              <span class="share-link">{shareUrl()}</span>
            </div>
            <div class="copied-msg">{copied() ? 'Link copied!' : ''}</div>
          </Show>
          <Show when={shareError()}>
            <div class="share-error">{shareError()}</div>
          </Show>
        </DialogContent>
        <DialogActions>
          <Show when={shareStep() === 'choose'}>
            <Button variant="outlined" onClick={commit}>
              {showInGallery() ? 'Publish' : 'Create link'}
            </Button>
          </Show>
          <Show when={shareStep() === 'link'}>
            <Button variant="outlined" onClick={copyLink}>Copy Link</Button>
          </Show>
        </DialogActions>
      </Dialog>

      <Dialog open={notice() !== null} onClose={() => setNotice(null)} maxWidth="xs">
        <DialogContent>{notice()}</DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setNotice(null)}>OK</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function App() {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/gallery' ? <Gallery /> : <Playground />;
}

render(() => <App />, document.getElementById('app'));
