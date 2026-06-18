// Gallery view: a paginated 4×4 grid of published sketch cards. Split out of main.jsx.
//
// The aurora-glass thumbnail effect is currently DISABLED via AURORA_ENABLED — the
// code (chroma-key + WebGL aurora wiring) is intentionally kept so it can be flipped
// back on. With it off, cards just show the static og thumbnail. aurora.js is NOT
// statically imported — it's lazy-loaded (dynamic import) only if re-enabled, so its
// ~445 lines of WebGL stay out of the gallery bundle.

import { createSignal, onMount, onCleanup, Show, For, createEffect, on } from 'solid-js';
import DEMO_GALLERY from './data/demo-gallery.json';
import { prettySlug } from './playground/slug.js';

const AURORA_ENABLED = false; // aurora glass behind thumbnails — OFF (dead code kept below)

const GALLERY_TITLE_MAX = 34; // cap at which gallery cards truncate the title (Fibonacci)
const GALLERY_PAGE_SIZE = 16; // one numbered page = a 4×4 grid of square cards
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Chroma-key a card image so the aurora shows through: select the flat
// background (corner color, per-channel tolerance), contract the selection and
// feather it — Photoshop-tuned values (wand 16, contract 3px, feather 6px) that
// leave a soft background-color glow hugging the model — then delete to alpha.
// Keyed at ~display resolution (KEY_MAXW), not the source 1200px, with contract/
// feather scaled to match — ~6x less pixel work, visually identical at card size.
const KEY_TOL = 16;
const KEY_CONTRACT = 3;
const KEY_FEATHER = 6;
const KEY_MAXW = 480;
function chromaKeyCard(img) {
  const scale = Math.min(1, KEY_MAXW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h); // downscale here
  const id = ctx.getImageData(0, 0, w, h); // throws if the image is cross-origin tainted
  const d = id.data;
  const bg = [d[0], d[1], d[2]];
  const contract = Math.max(1, Math.round(KEY_CONTRACT * scale)); // erode iterations, scaled
  const r = Math.max(1, Math.round((KEY_FEATHER * scale) / 2));   // blur radius, scaled

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
  for (let it = 0; it < contract; it++) {
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
const keyCache = new Map(); // src URL → keyed data URL, so paginating back doesn't recompute
function keyCardImage(imgEl) {
  if (imgEl.dataset.keyed) return; // don't re-key the data: URL we just set
  const src = imgEl.currentSrc || imgEl.src;
  const cached = keyCache.get(src);
  if (cached) { imgEl.dataset.keyed = '1'; imgEl.src = cached; return; }
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    try {
      const keyed = chromaKeyCard(probe);
      keyCache.set(src, keyed);
      imgEl.dataset.keyed = '1'; // set before swapping src so the re-fired onLoad fades it in
      imgEl.src = keyed;
    } catch { imgEl.classList.add('ready'); /* unreadable — fade in the opaque image */ }
  };
  probe.onerror = () => imgEl.classList.add('ready'); // CORS blocked — fade in the opaque image
  probe.src = src;
}

export function Gallery() {
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

  // --- aurora glass behind each thumbnail (DISABLED via AURORA_ENABLED) --------
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
    aurora?.destroy();
    aurora = undefined;
    setHoverReady(false);
    if (!AURORA_ENABLED) return; // aurora off — cards show the static og thumbnail (wiring below kept for re-enable)
    if (!list?.length) return;
    queueMicrotask(async () => {                    // let the new refs settle
      const cs = auroraCanvases.slice(0, list.length);
      if (cs.some((c) => !c)) return;
      try {
        // No hover on touch, so the resting state is all mobile users see — lift
        // the resting blobStrength and chroma spread so tiles bloom by default.
        const mobile = window.matchMedia('(max-width: 767px)').matches;
        const opts = mobile
          ? { ...AURORA, hover: { ...AURORA.hover, from: { ...AURORA.hover.from, blobStrength: 0.10, hueSpread: AURORA.hover.from.hueSpread * 1.4 } } }
          : AURORA;
        const { createAuroraGridGL } = await import('./aurora.js'); // lazy: only fetched if re-enabled
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
  onCleanup(() => aurora?.destroy());

  return (
    <>
      <header>
        <div class="brand">
          <a class="brand-link" href="/gallery"><img class="logo" src="/vzome-logo.svg" alt="vZome" title={`build ${__COMMIT__}`} /></a>
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
                        decoding="async"
                        onLoad={(e) => {
                          const im = e.currentTarget;
                          if (im.dataset.keyed) { im.classList.add('ready'); return; }
                          if (!AURORA_ENABLED) { im.classList.add('ready'); return; } // aurora off: fade in the opaque image, skip keying
                          keyCardImage(im);
                        }}
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
