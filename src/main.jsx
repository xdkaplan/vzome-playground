import { render } from 'solid-js/web';
import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';
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

// Deterministic "visual hash" per sketch — a cheeky DiceBear avatar seeded by
// the slug. Swap the style for 'thumbs', 'fun-emoji', 'shapes', 'rings', etc.
const HASH_STYLE = 'miniavs';
const hashUrl = (slug) =>
  `https://api.dicebear.com/9.x/${HASH_STYLE}/svg?seed=${encodeURIComponent(slug)}`;

// "stott-cantor-euler-r41be" -> "Stott Cantor Euler R41BE"
function prettySlug(slug) {
  const parts = slug.split('-');
  const suffix = parts.pop();
  const words = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return [...words, suffix.toUpperCase()].join(' ');
}

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
  const [status, setStatus] = createSignal('Ready.');
  const [output, setOutput] = createSignal('');
  const [inputName, setInputName] = createSignal('no input');
  const [running, setRunning] = createSignal(false);
  const [hasResult, setHasResult] = createSignal(false);
  const [docsOpen, setDocsOpen] = createSignal(true);
  const [codeOpen, setCodeOpen] = createSignal(true);
  const [viewOpen, setViewOpen] = createSignal(true);
  const [mobile, setMobile] = createSignal(false); // narrow window: flip/flop one pane at a time
  let mainEl;
  let viewAutoCollapsed = false; // true when the window (not a drag) collapsed the 3D pane
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareStep, setShareStep] = createSignal('choose');
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
      // ensure the viewer has room, else the resize below would re-collapse it
      const maxCode = mainEl.clientWidth - DIVIDER_W - VIEW_COLLAPSE_AT;
      if (codeW() > maxCode) setCodeW(Math.max(COLLAPSE_AT, maxCode));
    }
    viewAutoCollapsed = false;
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
      setRunning(false);
      if (type === 'SCRIPT_RESULT') {
        lastMesh = payload.mesh;
        setStatus(`Done — ${payload.edges} edges (engine: ${payload.engine}).`);

        const doc = new DOMParser().parseFromString(templateXml, 'application/xml');
        doc.querySelector('ImportSimpleMeshJson').textContent = payload.mesh;
        viewer.src = xmlToDataUrl(new XMLSerializer().serializeToString(doc));

        setOutput(payload.logs.join('\n'));
        setHasResult(true);
      } else if (type === 'SCRIPT_ERROR') {
        const logBlock = payload.logs.length ? payload.logs.join('\n') + '\n\n' : '';
        setStatus('Error: ' + payload.message);
        setOutput(logBlock + (payload.stack || payload.message));
        setHasResult(false);
      }
    };

    const shared = location.pathname.match(/^\/s\/(.+)$/);
    if (shared) loadSketch(decodeURIComponent(shared[1]));
  });

  const run = () => {
    if (!worker) return; // worker is created in onMount; ignore clicks before it's ready
    setStatus('Running…');
    setOutput('');
    setRunning(true);
    setHasResult(false);
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

  const openShare = () => {
    setParts(generateSlugParts());
    setShowInGallery(true);
    setCopied(false);
    setShareStep('choose');
    setShareOpen(true);
  };

  const reroll = () => setParts(generateSlugParts());

  // Commit the chosen slug (+ gallery flag) and reveal the link.
  // TODO: this is where the sketch gets persisted (POST → Worker → KV),
  // the viewer thumbnail captured → R2, and the gallery flag honored. Until
  // that backend exists, we just advance to the (not-yet-resolving) link.
  const commit = async () => {
    setCopied(false);
    try {
      const res = await fetch('/api/sketch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slugFromParts(parts()),
          code: editor.state.doc.toString(),
          description: composeDescription(title(), body()),
          title: title(),
          input: currentInput,
          mesh: lastMesh,
          public: showInGallery(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShareStep('link');
    } catch (e) {
      setStatus('Publish failed: ' + e.message + ' (backend running?)');
    }
  };

  const loadSketch = async (slug) => {
    const key = slug.toLowerCase(); // slugs are stored lowercase — case-insensitive load
    const pretty = prettySlug(key);
    try {
      const res = await fetch('/api/sketch/' + encodeURIComponent(key));
      if (!res.ok) {
        setStatus(`Sketch not found: "${pretty}"`);
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
      if (sk.mesh) {
        lastMesh = sk.mesh;
        const doc = new DOMParser().parseFromString(templateXml, 'application/xml');
        doc.querySelector('ImportSimpleMeshJson').textContent = sk.mesh;
        viewer.src = xmlToDataUrl(new XMLSerializer().serializeToString(doc));
        setHasResult(true);
        let edges = 0;
        try { edges = JSON.parse(sk.mesh).edges?.length ?? 0; } catch {}
        setStatus(`Loaded "${pretty}" — ${edges} edges. Press Run to recompute.`);
      } else {
        setStatus(`Loaded "${pretty}". Press Run.`);
      }
    } catch (e) {
      setStatus('Load error: ' + e.message);
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
                <input
                  class="docs-title-input"
                  value={title()}
                  placeholder="Title"
                  onInput={(e) => setTitle(e.currentTarget.value)}
                />
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
          <div id="status" class="muted">{status()}</div>
          <vzome-viewer id="viewer" preview={false}> </vzome-viewer>
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
    </>
  );
}

function Gallery() {
  const [items, setItems] = createSignal(null); // null = loading

  onMount(async () => {
    try {
      const res = await fetch('/api/gallery');
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    }
  });

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
                {(it) => (
                  <a class="gallery-card" href={`/s/${it.slug}`}>
                    <img class="gallery-hash" src={hashUrl(it.slug)} alt="" loading="lazy" />
                    <span class="gallery-card-title">{it.title || prettySlug(it.slug)}</span>
                    <span class="gallery-card-sub">{prettySlug(it.slug)}</span>
                  </a>
                )}
              </For>
            </div>
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
