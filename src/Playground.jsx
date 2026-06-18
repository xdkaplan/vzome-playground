import { createSignal, onMount, Show } from 'solid-js';
import Button from '@suid/material/Button';
import Dialog from '@suid/material/Dialog';
import DialogTitle from '@suid/material/DialogTitle';
import DialogContent from '@suid/material/DialogContent';
import DialogActions from '@suid/material/DialogActions';
import Checkbox from '@suid/material/Checkbox';
import FormControlLabel from '@suid/material/FormControlLabel';
import { createPaneLayout } from './playground/pane-layout.js';
import { createWorkspace } from './playground/workspace.js';
import { createShare } from './playground/share.js';
import { DEFAULT_TITLE, DEFAULT_BODY } from './playground/description.js';
import DEFAULT_SCRIPT from './defaultScript.js?raw'; // for the 404 fallback on a shared-link load

import 'https://www.vzome.com/modules/vzome-viewer.js';

// Hard cap on the sketch name at input time — a Fibonacci number.
const TITLE_MAX = 55;

// Max length for the plain-text description body — a Fibonacci number (golden).
const MAX_BODY = 610;

export function Playground() {
  // A shared-link load (/s/:slug) fetches its content async. Seed the docs + editor
  // EMPTY (not the defaults) so we don't flash "Project Title"/Sea-Urchin for a frame
  // and then reflow when the real sketch arrives; loadingSketch() gates that window.
  const sharedSlug = location.pathname.match(/^\/s\/(.+)$/)?.[1] ?? null;
  const [loadingSketch, setLoadingSketch] = createSignal(!!sharedSlug);

  // ── Description (title + body) shown in the docs pane ───────────────────────
  const [docsOpen, setDocsOpen] = createSignal(true);
  const [title, setTitle] = createSignal(sharedSlug ? '' : DEFAULT_TITLE);
  const [body, setBody] = createSignal(sharedSlug ? '' : DEFAULT_BODY);
  const [editingDoc, setEditingDoc] = createSignal(false);
  const [notice, setNotice] = createSignal(null); // OK-modal message (shared-link load failures)

  // ── Feature clusters, each in its own module ───────────────────────────────
  // Workspace: CodeMirror editor + vZome worker + vzome-viewer + the run
  // lifecycle. getTitle is read only to name the downloaded mesh file.
  const workspace = createWorkspace({ getTitle: title, blankStart: !!sharedSlug });
  const { running, hasResult, everRun, output, overlayState, inputName, run, download, onFileChange, refEditor } = workspace;

  // Resizable editor↔viewer panes (drag, reflow, mobile flip); measureEditor
  // re-measures CodeMirror after a resize.
  const { codeOpen, viewOpen, mobile, codeW, refMain, startDragCode, resetDivider, restoreCode, restoreView } =
    createPaneLayout({ measureEditor: workspace.measure });

  // Publish / load sketches — reaches into the workspace (code, input, thumbnail)
  // and the docs (title/body) it persists, plus the notice modal for errors.
  const { shareOpen, setShareOpen, shareStep, shareError, words, shareUrl, showInGallery, setShowInGallery, copied, openShare, reroll, commit, copyLink, loadSketch } =
    createShare({ workspace, getTitle: title, getBody: body, setTitle, setBody, setEditingDoc, setNotice });

  let fileInput; // hidden <input type=file>; the toolbar's Input button clicks it

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

  // Load a shared sketch on startup (/s/:slug). The editor is created in the
  // workspace's onMount (registered first, so it runs first); loadSketch only
  // needs the editor, not the worker or viewer. On a 404/error, fall back to the
  // normal defaults so the playground is still usable.
  onMount(async () => {
    if (!sharedSlug) return;
    const ok = await loadSketch(decodeURIComponent(sharedSlug));
    if (!ok) {
      setTitle(DEFAULT_TITLE);
      setBody(DEFAULT_BODY);
      workspace.setCode(DEFAULT_SCRIPT);
    }
    setLoadingSketch(false);
  });

  return (
    <>
      <header>
        <div class="brand">
          <a class="brand-link" href="/gallery"><img class="logo" src="/vzome-logo.svg" alt="vZome" title={`build ${__COMMIT__}`} /></a>
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
      <main ref={refMain}>
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
                fallback={<span class="docs-title">{loadingSketch() ? 'Loading…' : title()}</span>}
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
          <div id="editor" ref={refEditor} />
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
