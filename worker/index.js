// Cloudflare Worker: thin backend for sharing sketches.
//
// Routes:
//   POST /api/sketch          store a sketch (immutable — 409 if slug exists)
//   GET  /api/sketch/:slug    fetch a sketch (code + description + input)
//   GET  /og/:slug.png        the OG card image (PNG), stored under og:<slug>
//   GET  /api/gallery         list public sketches (newest first)
//   GET  /s/:slug             serve the SPA shell + injected OG/Twitter meta
//   *                         static assets (SPA fallback handles /gallery etc.)
//
// Storage: a single KV namespace (binding SKETCHES). Each entry stores the
// script + description + input as JSON; key metadata holds {public, created}
// so the gallery can list without reading every value. The mesh is NOT stored
// — loading a sketch restores the code and the viewer renders only after Run.
// Immutable: slugs never change.

const MAX_CODE = 256 * 1024; // 256 KiB cap on a stored script

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// --- helpers for OG-meta injection on /s/:slug ---------------------------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Descriptions are stored as "# Title\n\nbody". Pull the title / a body excerpt.
const titleFromDescription = (md) => {
  const m = (md || '').match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
};
const descExcerpt = (md, n = 160) => {
  const body = (md || '').replace(/^\s*#{1,6}\s+.+$/m, '').replace(/\s+/g, ' ').trim();
  return body.length > n ? body.slice(0, n - 1).trimEnd() + '…' : body;
};
// Slugs are "word-word-word-suffix"; drop the suffix and title-case the words.
const prettySlug = (slug) =>
  slug
    .split('-')
    .slice(0, -1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || slug;

// Sniff the image MIME from the magic bytes. Cards may be PNG, JPEG, or WebP —
// and Safari's toBlob('image/webp') silently falls back to PNG — so never assume
// a single type when serving og:<slug>.
const sniffImageType = (buf) => {
  const u = new Uint8Array(buf);
  if (u[0] === 0x89 && u[1] === 0x50) return 'image/png';   // 89 50 4E 47  (PNG)
  if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';  // FF D8        (JPEG)
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&  // "RIFF"
      u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50)  // "WEBP"
    return 'image/webp';
  return 'image/png'; // safe default
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // --- Store a sketch -----------------------------------------------------
    if (pathname === '/api/sketch' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid JSON' }, 400);
      }
      const { slug, code } = body;
      if (!slug || !code) return json({ error: 'slug and code required' }, 400);

      // Cap the script size: generous for a real sketch, but well under KV's
      // 25 MiB value limit and the Worker CPU budget for parsing the payload.
      if (typeof code !== 'string' || code.length > MAX_CODE) {
        return json({ error: 'code too large' }, 413);
      }

      // Immutable: refuse to overwrite an existing slug.
      if (await env.SKETCHES.get(slug)) return json({ error: 'slug exists' }, 409);

      const title = (body.title || '').slice(0, 100);
      const record = {
        code,
        description: body.description ?? '',
        input: body.input ?? null,
        public: !!body.public,
        created: Date.now(),
      };
      await env.SKETCHES.put(slug, JSON.stringify(record), {
        metadata: { public: record.public, created: record.created, title },
      });

      // Optional OG card image (base64 PNG), stored under a separate key so it
      // doesn't bloat the sketch record fetched on load.
      if (typeof body.image === 'string' && body.image) {
        try {
          const bytes = Uint8Array.from(atob(body.image), (c) => c.charCodeAt(0));
          await env.SKETCHES.put('og:' + slug.toLowerCase(), bytes);
        } catch { /* ignore a malformed image */ }
      }

      // A new public sketch lands on gallery page 1 — drop the cached gallery
      // pages so it shows up immediately (rather than waiting out the max-age).
      if (record.public) {
        const g = `${url.origin}/api/gallery`;
        ctx.waitUntil(Promise.all([
          caches.default.delete(`${g}?page=1&limit=16`), // the app's page 1
          caches.default.delete(`${g}?page=1&limit=21`), // the worker default
          caches.default.delete(g),
        ]).catch(() => {}));
      }

      return json({ ok: true, slug });
    }

    // --- OG card image (PNG / JPEG / WebP — type sniffed from bytes) --------
    if (pathname.startsWith('/og/') && request.method === 'GET') {
      const slug = decodeURIComponent(pathname.slice('/og/'.length).replace(/\.png$/, '')).toLowerCase();
      const img = await env.SKETCHES.get('og:' + slug, 'arrayBuffer');
      if (!img) return new Response('not found', { status: 404 });
      return new Response(img, {
        headers: {
          'content-type': sniffImageType(img),
          'cache-control': 'public, max-age=31536000, immutable',
          // allow the gallery to read pixels (chroma-key the bg to alpha) even
          // when the card is loaded cross-origin (e.g. dev against prod images)
          'access-control-allow-origin': '*',
        },
      });
    }

    // --- Fetch a sketch -----------------------------------------------------
    if (pathname.startsWith('/api/sketch/') && request.method === 'GET') {
      const slug = decodeURIComponent(pathname.slice('/api/sketch/'.length));
      const value = await env.SKETCHES.get(slug);
      if (!value) return json({ error: 'not found' }, 404);
      return json(JSON.parse(value));
    }

    // --- Gallery list (public only, newest first, paged) --------------------
    if (pathname === '/api/gallery' && request.method === 'GET') {
      // The list scan below is O(total sketches); cache the rendered page at the
      // edge so repeated loads don't re-scan KV. Stale up to max-age after a publish.
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;

      // Page through all keys (list() caps at 1000). The og:<slug> image keys
      // have no metadata, so the public filter drops them automatically.
      // Newest-first sorting needs every key in hand, so we read them all and
      // then return just the requested page (?page, ?limit).
      const keys = [];
      let cursor;
      do {
        const res = await env.SKETCHES.list({ cursor });
        keys.push(...res.keys);
        cursor = res.list_complete ? null : res.cursor;
      } while (cursor);
      const all = keys
        .filter((k) => k.metadata && k.metadata.public)
        .sort((a, b) => (b.metadata.created || 0) - (a.metadata.created || 0));

      const total = all.length;
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 21));
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(totalPages, Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1));
      const items = all
        .slice((page - 1) * pageSize, page * pageSize)
        .map((k) => ({ slug: k.name, created: k.metadata.created, title: k.metadata.title || '' }));
      const res = json({ items, page, pageSize, total, totalPages });
      res.headers.set('cache-control', 'public, max-age=30');
      ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    }

    // --- Shared sketch page: SPA shell + injected OG/Twitter card meta ------
    // Crawlers (FB/Discord/Slack) don't run JS, so inject static <meta> tags.
    // The shell is tiny, so read it as text and string-inject (robust, no
    // dependency on HTMLRewriter's handling of the assets response).
    if (pathname.startsWith('/s/')) {
      const shellReq = () => new Request(new URL('/', url), request);
      try {
        const slug = decodeURIComponent(pathname.slice('/s/'.length)).toLowerCase();
        const v = await env.SKETCHES.get(slug);
        if (!v) return env.ASSETS.fetch(shellReq());
        const record = JSON.parse(v);

        const title = titleFromDescription(record.description) || prettySlug(slug);
        const desc = descExcerpt(record.description) || 'A vZome Playground sketch.';
        const image = `${url.origin}/og/${slug}.png`;
        const pageUrl = `${url.origin}/s/${slug}`;
        const tags =
          `<meta property="og:type" content="website">` +
          `<meta property="og:title" content="${esc(title)}">` +
          `<meta property="og:description" content="${esc(desc)}">` +
          `<meta property="og:url" content="${esc(pageUrl)}">` +
          `<meta property="og:image" content="${esc(image)}">` +
          `<meta name="twitter:card" content="summary_large_image">` +
          `<meta name="twitter:title" content="${esc(title)}">` +
          `<meta name="twitter:description" content="${esc(desc)}">` +
          `<meta name="twitter:image" content="${esc(image)}">`;

        const shell = await env.ASSETS.fetch(shellReq());
        let html = await shell.text();
        html = html
          .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)} — vZome Playground</title>`)
          .replace('</head>', tags + '</head>');
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      } catch {
        return env.ASSETS.fetch(shellReq()); // never 500 the share page
      }
    }

    // --- Everything else → static assets (SPA fallback) ---------------------
    return env.ASSETS.fetch(request);
  },
};
