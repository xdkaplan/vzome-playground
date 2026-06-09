import { render } from 'solid-js/web';
import { createSignal, onMount, Show } from 'solid-js';
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
import DOC_MD from './docs/triangles.md?raw';
import { createViewer } from './playground/viewer.js';
import './style.css';

const DOC_HTML = marked.parse(DOC_MD);

function App() {
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

  onMount(() => {
    editor = new EditorView({
      doc: DEFAULT_SCRIPT,
      extensions: [basicSetup, javascript()],
      parent: editorEl,
    });
    viewer = createViewer(canvasEl);
    worker = new Worker(new URL('./playground/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { type, payload } = e.data;
      setRunning(false);
      if (type === 'SCRIPT_RESULT') {
        lastMesh = payload.mesh;
        setStatus(`Done — ${payload.edges} edges (engine: ${payload.engine}).`);
        viewer.render(payload.mesh);
        setOutput(payload.logs.join('\n'));
        setHasResult(true);
      } else if (type === 'SCRIPT_ERROR') {
        const logBlock = payload.logs.length ? payload.logs.join('\n') + '\n\n' : '';
        setStatus('Error: ' + payload.message);
        setOutput(logBlock + (payload.stack || payload.message));
        setHasResult(false);
      }
    };
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
  const commit = () => {
    setCopied(false);
    setShareStep('link');
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
            <button
              class="icon-btn"
              onClick={() => setDocsOpen((v) => !v)}
              title={docsOpen() ? 'Hide docs' : 'Show docs'}
            >
              <img src={docsOpen() ? '/sidebar-collapse.svg' : '/sidebar-expand.svg'} alt="Toggle docs" />
            </button>
          </div>
          <Show when={docsOpen()}>
            <div class="docs-body" innerHTML={DOC_HTML} />
          </Show>
        </aside>
        <section id="editor-pane">
          <div id="editor" ref={editorEl} />
        </section>
        <section id="output-pane">
          <div id="status" class="muted">{status()}</div>
          <canvas id="viewer" ref={canvasEl} />
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

render(() => <App />, document.getElementById('app'));
