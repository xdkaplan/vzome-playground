import { createSignal } from 'solid-js';
import { generateSlugParts, slugFromParts, prettySlug } from './slug.js';
import { titleFromDescription, bodyFromDescription, composeDescription, DEFAULT_DESCRIPTION } from './description.js';

// Publish / load sketches. A sketch = code + description + input; the mesh is
// NOT stored (loading requires pressing Run). This module owns the Share dialog
// state and the "is this already online?" snapshot, and reaches into:
//   - `workspace` for the code, the file input, and the OG thumbnail
//   - the docs accessors (getTitle/getBody/setTitle/setBody/setEditingDoc)
//   - `setNotice` for the OK-modal on load/publish failures
export function createShare({ workspace, getTitle, getBody, setTitle, setBody, setEditingDoc, setNotice }) {
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareStep, setShareStep] = createSignal('choose');
  const [shareError, setShareError] = createSignal(null); // inline publish failure in the Share dialog
  const [parts, setParts] = createSignal({ words: [], suffix: '' });
  const [showInGallery, setShowInGallery] = createSignal(true);
  const [copied, setCopied] = createSignal(false);

  // Snapshot of the content the moment it was last published or loaded (code +
  // title + body + slug parts). If the current content still matches, the sketch
  // is already online and Share can jump straight to the link.
  let published = null;
  const partsFromSlug = (slug) => { const a = slug.split('-'); return { words: a.slice(0, -1), suffix: a.at(-1) }; };

  const words = () => parts().words;
  const shareUrl = () => `${location.origin}/s/${slugFromParts(parts())}`;
  const isUnchanged = () =>
    published &&
    workspace.getCode() === published.code &&
    getTitle() === published.title &&
    getBody() === published.body;

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
  const commit = async () => {
    setCopied(false);
    setShareError(null);
    try {
      const image = workspace.hasResult() ? await workspace.captureThumbnail() : null;
      const res = await fetch('/api/sketch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slugFromParts(parts()),
          code: workspace.getCode(),
          description: composeDescription(getTitle(), getBody()),
          title: getTitle(),
          input: workspace.getInput(),
          public: showInGallery(),
          image,
        }),
      });
      if (res.status === 413) { setNotice('Your script is longer than the server allows.'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      published = { code: workspace.getCode(), title: getTitle(), body: getBody(), parts: parts() };
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
      workspace.setCode(sk.code);
      const desc = sk.description || DEFAULT_DESCRIPTION;
      setTitle(titleFromDescription(desc) || pretty);
      setBody(bodyFromDescription(desc));
      setEditingDoc(false);
      document.title = (titleFromDescription(desc) || pretty) + ' — vZome Playground';
      workspace.loadInput(sk.input ?? null);
      workspace.resetRunState();
      // it's already online at this slug — Share can link straight to it until edited
      // Alex: The KV worker has a bit of a lag, I wonder if this would create issues
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

  return {
    shareOpen, setShareOpen, shareStep, shareError, words, shareUrl,
    showInGallery, setShowInGallery, copied,
    openShare, reroll, commit, copyLink, loadSketch,
  };
}
