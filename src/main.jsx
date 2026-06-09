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
import { marked } from 'marked';

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

// Lazy-loaded Milkdown WYSIWYG editor for the description body. Only authors who
// open the editor pay its weight; viewers and the gallery see rendered markdown.
function DescriptionEditor(props) {
  let root;
  let crepe = null;
  onMount(async () => {
    try {
      const mod = await import('@milkdown/crepe');
      await import('@milkdown/crepe/theme/common/style.css');
      await import('@milkdown/crepe/theme/frame.css');
      crepe = new mod.Crepe({
        root,
        defaultValue: props.value,
        features: { [mod.Crepe.Feature.BlockEdit]: false },
      });
      await crepe.create();
      props.onReady?.(() => crepe.getMarkdown());
    } catch (e) {
      console.error('Milkdown failed to load:', e);
      props.onFail?.();
    }
  });
  onCleanup(() => {
    if (crepe) {
      try { props.onChange?.(crepe.getMarkdown()); } catch {}
      try { crepe.destroy(); } catch {}
      crepe = null;
    }
  });
  return <div class="docs-wysiwyg" ref={root} />;
}

function Playground() {
  const [status, setStatus] = createSignal('Ready.');
  const [output, setOutput] = createSignal('');
  const [inputName, setInputName] = createSignal('no input');
  const [hasResult, setHasResult] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [docsOpen, setDocsOpen] = createSignal(true);
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareStep, setShareStep] = createSignal('choose');
  const [parts, setParts] = createSignal({ words: [], suffix: '' });
  const [showInGallery, setShowInGallery] = createSignal(true);
  const [copied, setCopied] = createSignal(false);
  const [title, setTitle] = createSignal(DEFAULT_TITLE);
  const [body, setBody] = createSignal(DEFAULT_BODY);
  const [editingDoc, setEditingDoc] = createSignal(false);
  const [wysiwygFailed, setWysiwygFailed] = createSignal(false);
  let getLiveBody = null; // set by the WYSIWYG editor; returns its current markdown

  // Body markdown right now (live from the editor if it's open, else the signal).
  const currentBody = () => {
    try {
      return editingDoc() && getLiveBody ? getLiveBody() : body();
    } catch {
      return body();
    }
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

  onMount(async () => {
    editor = new EditorView({
      doc: DEFAULT_SCRIPT,
      extensions: [basicSetup, javascript()],
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
        console.dir(payload.mesh);
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
    setStatus('Running…');
    setOutput('');
    setHasResult(false);
    setRunning(true);
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

  const exportMesh = () => {
    if (!lastMesh) return;
    const blob = new Blob([JSON.stringify(lastMesh, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mesh.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMesh = async () => {
    if (!lastMesh) return;
    await navigator.clipboard.writeText(JSON.stringify(lastMesh));
    setStatus('Mesh copied to clipboard.');
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
          description: composeDescription(title(), currentBody()),
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
      setWysiwygFailed(false);
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
          <img class="logo" src="/vzome-logo.svg" alt="vZome" />
          <h1>vZome Playground</h1>
          <span class="spacer" />
          <a class="nav-link" href="/gallery">Gallery</a>
        </div>
        <div class="toolbar">
          <Button variant="outlined" size="small" onClick={() => fileInput.click()}>Select input…</Button>
          <input type="file" ref={fileInput} hidden onChange={onFileChange} />
          <span class="muted">{inputName()}</span>
          <span class="spacer" />
          <Button variant="outlined" size="small" onClick={run} disabled={running()}>Run ▶</Button>
          <Button variant="outlined" size="small" onClick={exportMesh} disabled={!hasResult()}>Export Mesh</Button>
          <Button variant="outlined" size="small" onClick={copyMesh} disabled={!hasResult()}>Copy Mesh</Button>
          <Button variant="outlined" size="small" onClick={openShare}>Share</Button>
        </div>
      </header>
      <main>
        <aside id="docs-pane" classList={{ collapsed: !docsOpen() }}>
          <div class="docs-header">
            <Show when={docsOpen()}>
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
                  <button class="icon-btn" onClick={() => setEditingDoc(true)} title="Edit description">
                    <img src="/pencil-edit.svg" alt="Edit" />
                  </button>
                }
              >
                <Button variant="outlined" size="small" onClick={() => setEditingDoc(false)}>
                  Finish
                </Button>
              </Show>
            </Show>
            <button
              class="icon-btn docs-collapse"
              onClick={() => setDocsOpen((v) => !v)}
              title={docsOpen() ? 'Hide docs' : 'Show docs'}
            >
              <img src={docsOpen() ? '/sidebar-collapse.svg' : '/sidebar-expand.svg'} alt="Toggle docs" />
            </button>
          </div>
          <Show when={docsOpen()}>
            <Show
              when={editingDoc()}
              fallback={<div class="docs-body" innerHTML={marked.parse(body())} />}
            >
              <Show
                when={!wysiwygFailed()}
                fallback={
                  <textarea
                    class="docs-edit"
                    value={body()}
                    onInput={(e) => setBody(e.currentTarget.value)}
                  />
                }
              >
                <DescriptionEditor
                  value={body()}
                  onChange={setBody}
                  onReady={(fn) => (getLiveBody = fn)}
                  onFail={() => setWysiwygFailed(true)}
                />
              </Show>
            </Show>
          </Show>
        </aside>
        <section id="editor-pane">
          <div id="editor" ref={editorEl} />
        </section>
        <section id="output-pane">
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
            <div class="share-words-row">
              <Button
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
          <a href="/"><img class="logo" src="/vzome-logo.svg" alt="vZome" /></a>
          <h1>vZome Playground</h1>
          <span class="spacer" />
          <a class="nav-link" href="/">&larr; Playground</a>
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
