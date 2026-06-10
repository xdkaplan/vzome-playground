import { render } from 'solid-js/web';
import { createSignal, onMount, onCleanup, Show, For, createEffect, on } from 'solid-js';
import Button from '@suid/material/Button';
import Dialog from '@suid/material/Dialog';
import DialogTitle from '@suid/material/DialogTitle';
import DialogContent from '@suid/material/DialogContent';
import DialogActions from '@suid/material/DialogActions';
import Checkbox from '@suid/material/Checkbox';
import FormControlLabel from '@suid/material/FormControlLabel';
import { generateSlugParts, slugFromParts } from './playground/slug.js';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { apiCompletions } from './playground/api-completions.js';

import DEFAULT_SCRIPT from './defaultScript.js?raw';
import DEFAULT_DESCRIPTION from './docs/default-description.md?raw';
import DEMO_GALLERY from './data/demo-gallery.json';
import { createAuroraGridGL } from './aurora.js';
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

// "stott-cantor-euler-r41be" -> "Stott Cantor Euler R41BE"
function prettySlug(slug) {
  const parts = slug.split('-');
  const suffix = parts.pop();
  const words = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return [...words, suffix.toUpperCase()].join(' ');
}

// Hard cap on the sketch name at input time, and the (shorter) cap at which
// gallery cards truncate the title for display — both Fibonacci.
const TITLE_MAX = 55;
const GALLERY_TITLE_MAX = 34;
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Gallery shows one numbered page at a time: a 4×4 grid of square cards.
const GALLERY_PAGE_SIZE = 16;

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
  const [engineReady, setEngineReady] = createSignal(false); // vZome engine finished loading in the worker
  const [hasResult, setHasResult] = createSignal(false);
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
  const overlayState = () => {
    if (hasResult()) return null;
    if (running()) return engineReady() ? 'running' : 'loading';
    if (errored()) return 'error';
    return 'idle';
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
    setParts(generateSlugParts());
    setShowInGallery(true);
    setCopied(false);
    setShareError(null);
    setShareStep('choose');
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
          <Show when={mobile()} fallback={
            <Button variant="outlined" size="small" onClick={run} disabled={running()}>Run ▶</Button>
          }>
            <button class="play-fab" onClick={run} disabled={running()} title="Run">
              <img src="/play-icon.svg" alt="Run" />
            </button>
          </Show>
          <Show when={mobile()} fallback={
            <Button variant="outlined" size="small" onClick={download} disabled={!hasResult()}>Download</Button>
          }>
            <button class="icon-btn" onClick={download} disabled={!hasResult()} title="Download">
              <img src="/download-icon.svg" alt="Download" />
            </button>
          </Show>
          <Show when={mobile()} fallback={
            <Button variant="outlined" size="small" onClick={openShare}>Share</Button>
          }>
            <button class="icon-btn" onClick={openShare} title="Share">
              <img src="/share-icon.svg" alt="Share" />
            </button>
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
          <div class="viewer-wrap">
            <vzome-viewer id="viewer" preview={false}> </vzome-viewer>
            <Show when={overlayState()}>
              <div class="canvas-overlay">
                <div class="canvas-overlay-card" classList={{ error: overlayState() === 'error' }}>
                  {overlayState() === 'loading' ? 'Loading vZome…'
                    : overlayState() === 'running' ? 'Running…'
                    : overlayState() === 'error' ? 'Run Failed'
                    : <>Nothing to see here.<br />Press RUN.</>}
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

// Chroma-key a card image so the aurora shows through: select the flat
// background (corner color, per-channel tolerance), contract the selection and
// feather it — Photoshop-tuned values (wand 16, contract 3px, feather 6px) that
// leave a soft background-color glow hugging the model — then delete to alpha.
const KEY_TOL = 16;
const KEY_CONTRACT = 3;
const KEY_FEATHER = 6;
function chromaKeyCard(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h); // throws if the image is cross-origin tainted
  const d = id.data;
  const bg = [d[0], d[1], d[2]];

  // selection mask: 1 = background (within tolerance of the corner color)
  let mask = new Float32Array(w * h);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    mask[i] =
      Math.abs(d[p] - bg[0]) <= KEY_TOL &&
      Math.abs(d[p + 1] - bg[1]) <= KEY_TOL &&
      Math.abs(d[p + 2] - bg[2]) <= KEY_TOL
        ? 1 : 0;
  }
  let tmp = new Float32Array(w * h);

  // contract: erode the selection (3x3 min) so a ring of bg pixels stays opaque
  for (let it = 0; it < KEY_CONTRACT; it++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1) * w, y1 = y * w, y2 = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 1), x2 = Math.min(w - 1, x + 1);
        tmp[y1 + x] = Math.min(
          mask[y0 + x0], mask[y0 + x], mask[y0 + x2],
          mask[y1 + x0], mask[y1 + x], mask[y1 + x2],
          mask[y2 + x0], mask[y2 + x], mask[y2 + x2],
        );
      }
    }
    [mask, tmp] = [tmp, mask];
  }

  // feather: separable box blur x3 ≈ gaussian of the requested radius
  const r = Math.max(1, Math.round(KEY_FEATHER / 2));
  const span = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { // horizontal
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += mask[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / span;
        acc += mask[row + Math.min(w - 1, x + r + 1)] - mask[row + Math.max(0, x - r)];
      }
    }
    [mask, tmp] = [tmp, mask];
    for (let x = 0; x < w; x++) { // vertical
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += mask[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        tmp[y * w + x] = acc / span;
        acc += mask[Math.min(h - 1, y + r + 1) * w + x] - mask[Math.max(0, y - r) * w + x];
      }
    }
    [mask, tmp] = [tmp, mask];
  }

  for (let i = 0, p = 3; i < mask.length; i++, p += 4) d[p] = Math.round(255 * (1 - mask[i]));
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

// Swap a loaded card image for its chroma-keyed (transparent-background) version
// so the aurora behind shows through. A separate CORS copy is loaded to read the
// pixels; if that's blocked (cross-origin without CORS headers) or unreadable, we
// silently keep the opaque image.
function keyCardImage(imgEl) {
  if (imgEl.dataset.keyed) return; // don't re-key the data: URL we just set
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    try {
      const keyed = chromaKeyCard(probe);
      imgEl.dataset.keyed = '1'; // set before swapping src so the re-fired onLoad fades it in
      imgEl.src = keyed;
    } catch { imgEl.classList.add('ready'); /* unreadable — fade in the opaque image */ }
  };
  probe.onerror = () => imgEl.classList.add('ready'); // CORS blocked — fade in the opaque image
  probe.src = imgEl.currentSrc || imgEl.src;
}

function Gallery() {
  const [items, setItems] = createSignal(null); // null = loading
  const [page, setPage] = createSignal(1);
  const [totalPages, setTotalPages] = createSignal(1);

  // Fetch one numbered page. The worker sorts newest-first and returns a slice
  // plus totalPages; in vite dev (no worker) we slice the Demo-Gallery locally.
  const loadPage = async (p) => {
    try {
      const res = await fetch(`/api/gallery?page=${p}&limit=${GALLERY_PAGE_SIZE}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotalPages(data.totalPages || 1);
      setPage(data.page || p);
    } catch {
      if (import.meta.env.DEV) {
        const start = (p - 1) * GALLERY_PAGE_SIZE;
        setItems(DEMO_GALLERY.slice(start, start + GALLERY_PAGE_SIZE));
        setTotalPages(Math.max(1, Math.ceil(DEMO_GALLERY.length / GALLERY_PAGE_SIZE)));
        setPage(p);
        return;
      }
      setItems([]);
      setTotalPages(1);
    }
  };

  const goTo = (p) => {
    if (p < 1 || p > totalPages() || p === page()) return;
    setItems(null); // show loading while the next page arrives
    loadPage(p);
    window.scrollTo({ top: 0 });
  };

  onMount(() => loadPage(1));

  // --- aurora glass behind each thumbnail --------------------------------
  // One shared WebGL2 context drives all 16 cards (16-context limit). The og
  // image multiplies over the aurora; locking the aurora mean to white keeps the
  // model/padding true and lets only the living variations tint through.
  let auroraCanvases = [];
  let aurora;
  const [hoverReady, setHoverReady] = createSignal(false); // suppress hover until the page is fully rendered
  const AURORA = {
    targetColor: '#8CC2E7', // CIELAB mean locked to the viewer's baby-blue background
    res: 32, // tiny buffer (soft blobs are low-frequency); CSS upscales it → cheap copies
    grain: 0, // no frosted grain — it pixelates when the tiny buffer is upscaled
    maxFps: 20, // cap the per-hover loop so it stays responsive
    hover: {
      duration: 0.4,
      from: { blobStrength: 0.03, hueSpread: 0.30 }, // rest: near-flat #8CC2E7
      to: { blobStrength: 0.40, hueSpread: 2.40 },   // hover: bloom
      breath: { rate: 0.31, amount: { blobStrength: 0.22, hueSpread: 1.2 } }, // calm rate, visible amplitude
    },
  };
  // rebuild the shared controller on every page (items() changes on paginate)
  createEffect(on(items, (list) => {
    aurora?.stop();
    aurora = undefined;
    setHoverReady(false);
    if (!list?.length) return;
    queueMicrotask(() => {                          // let the new refs settle
      const cs = auroraCanvases.slice(0, list.length);
      if (cs.some((c) => !c)) return;
      try {
        // No hover on touch, so the resting state is all mobile users see — lift
        // the resting blobStrength and chroma spread so tiles bloom by default.
        const mobile = window.matchMedia('(max-width: 767px)').matches;
        const opts = mobile
          ? { ...AURORA, hover: { ...AURORA.hover, from: { ...AURORA.hover.from, blobStrength: 0.10, hueSpread: AURORA.hover.from.hueSpread * 1.4 } } }
          : AURORA;
        aurora = createAuroraGridGL(cs, list.map((_, i) => ({ seed: i + 1, time: i * 1.37 })), opts);
      } catch {                                      // no WebGL2 → flat baby blue
        cs.forEach((c) => { const x = c.getContext('2d'); x.fillStyle = '#8CC2E7'; x.fillRect(0, 0, c.width, c.height); });
      }
      cs.forEach((c) => c.classList.add('ready')); // fade the painted buffer in (avoid a pop over the base color)
      // only allow hover once the browser is idle (aurora painted + images keyed),
      // so mousing over mid-load doesn't pile work onto the render
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 400));
      idle(() => setHoverReady(true), { timeout: 2500 });
    });
  }));
  onCleanup(() => aurora?.stop());

  return (
    <>
      <header>
        <div class="brand">
          <a class="brand-link" href="/gallery"><img class="logo" src="/vzome-logo.svg" alt="vZome" /></a>
          <a class="brand-link" href="/gallery"><h1>vZome Playground</h1></a>
          <span class="spacer" />
          <a class="create-link" href="/">Create a sketch</a>
        </div>
      </header>
      <main class="gallery-main">
        <Show when={items() !== null} fallback={<p class="gallery-empty">Loading&hellip;</p>}>
          <Show
            when={items().length}
            fallback={
              <p class="gallery-empty">
                No public sketches yet. Publish one with &ldquo;Show in Gallery&rdquo; ticked.
              </p>
            }
          >
            <div class="gallery-grid">
              <For each={items()}>
                {(it, i) => (
                  <a
                    class="gallery-card"
                    href={`/s/${it.slug}`}
                    onMouseEnter={() => hoverReady() && aurora?.setHover(i(), true)}
                    onMouseLeave={() => hoverReady() && aurora?.setHover(i(), false)}
                  >
                    <div class="gallery-thumb">
                      <canvas class="aurora-bg" width="32" height="32" ref={(el) => (auroraCanvases[i()] = el)} />
                      <img
                        class="aurora-fg"
                        src={it.thumb || `/og/${it.slug}.png`}
                        alt=""
                        loading="lazy"
                        onLoad={(e) => { const im = e.currentTarget; if (im.dataset.keyed) im.classList.add('ready'); else keyCardImage(im); }}
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    </div>
                    <span class="gallery-tag">{truncate(it.title || prettySlug(it.slug), GALLERY_TITLE_MAX)}</span>
                  </a>
                )}
              </For>
            </div>
            <Show when={totalPages() > 1}>
              <nav class="gallery-pager" aria-label="Gallery pages">
                <button
                  class="pager-btn"
                  disabled={page() <= 1}
                  onClick={() => goTo(page() - 1)}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <For each={Array.from({ length: totalPages() }, (_, i) => i + 1)}>
                  {(p) => (
                    <button
                      class="pager-btn"
                      classList={{ active: p === page() }}
                      aria-current={p === page() ? 'page' : undefined}
                      onClick={() => goTo(p)}
                    >
                      {p}
                    </button>
                  )}
                </For>
                <button
                  class="pager-btn"
                  disabled={page() >= totalPages()}
                  onClick={() => goTo(page() + 1)}
                  aria-label="Next page"
                >
                  ›
                </button>
              </nav>
            </Show>
          </Show>
        </Show>
      </main>
    </>
  );
}

function App() {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/gallery' ? <Gallery /> : <Playground />;
}

render(() => <App />, document.getElementById('app'));
