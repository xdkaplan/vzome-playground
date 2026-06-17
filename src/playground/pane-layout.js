import { createSignal, onMount, onCleanup } from 'solid-js';

// Resizable / collapsible editor↔viewer panes: the divider drag, the responsive
// reflow, and the mobile flip/flop. Owns codeOpen / viewOpen / mobile / codeW
// plus the <main> element ref and the ResizeObserver that drives reflow.
//
// `measureEditor` is called (inside rAF) after a layout change so CodeMirror
// re-measures its now-resized viewport. The host wires it to the editor; the
// hook stays unaware of CodeMirror.
//
// Returns getters + action handlers + `refMain` (a callback ref for <main>).
// Setters are intentionally not exposed — nothing outside the pane logic flips
// these signals.
export function createPaneLayout({ measureEditor } = {}) {
  const [codeOpen, setCodeOpen] = createSignal(true);
  const [viewOpen, setViewOpen] = createSignal(true);
  const [mobile, setMobile] = createSignal(false); // narrow window: flip/flop one pane at a time
  const DEFAULT_CODE_W = 620; // default editor pane width (double-click the divider to reset)
  const [codeW, setCodeW] = createSignal(DEFAULT_CODE_W); // editor pane width; viewer takes the rest
  let mainEl;
  let viewAutoCollapsed = false; // true when the window (not a drag) collapsed the 3D pane
  let restoreCodeW = DEFAULT_CODE_W; // width to pop back to after a drag collapses the code pane
  const refMain = (el) => { mainEl = el; };

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
    requestAnimationFrame(() => measureEditor?.());
  };

  const restoreCode = () => {
    setCodeW(restoreCodeW);
    setCodeOpen(true);
    if (mobile()) setViewOpen(false); // mobile flip: showing code hides 3D into its gutter
    requestAnimationFrame(() => measureEditor?.());
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

  // Responsive layout observer — set up synchronously so onCleanup registers in
  // the reactive root (avoids leaking/duplicating observers across HMR).
  onMount(() => {
    if (!mainEl) return;
    reflow();
    const ro = new ResizeObserver(reflow);
    ro.observe(mainEl);
    onCleanup(() => ro.disconnect());
  });

  return { codeOpen, viewOpen, mobile, codeW, refMain, startDragCode, resetDivider, restoreCode, restoreView };
}
