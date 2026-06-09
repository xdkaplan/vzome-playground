// Cloudflare Worker: thin backend for sharing sketches.
//
// Routes:
//   POST /api/sketch          store a sketch (immutable — 409 if slug exists)
//   GET  /api/sketch/:slug    fetch a sketch (code + mesh)
//   GET  /api/gallery         list public sketches (newest first)
//   GET  /s/:slug             serve the SPA shell (OG-meta injection is TODO)
//   *                         static assets (SPA fallback handles /gallery etc.)
//
// Storage: a single KV namespace (binding SKETCHES). Each entry stores the
// script + last-run mesh as JSON; key metadata holds {public, created} so the
// gallery can list without reading every value. Immutable: slugs never change.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(request, env) {
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

      // Immutable: refuse to overwrite an existing slug.
      if (await env.SKETCHES.get(slug)) return json({ error: 'slug exists' }, 409);

      const title = (body.title || '').slice(0, 100);
      const record = {
        code,
        description: body.description ?? '',
        input: body.input ?? null,
        mesh: body.mesh ?? null,
        public: !!body.public,
        created: Date.now(),
      };
      await env.SKETCHES.put(slug, JSON.stringify(record), {
        metadata: { public: record.public, created: record.created, title },
      });
      return json({ ok: true, slug });
    }

    // --- Fetch a sketch -----------------------------------------------------
    if (pathname.startsWith('/api/sketch/') && request.method === 'GET') {
      const slug = decodeURIComponent(pathname.slice('/api/sketch/'.length));
      const value = await env.SKETCHES.get(slug);
      if (!value) return json({ error: 'not found' }, 404);
      return json(JSON.parse(value));
    }

    // --- Gallery list (public only, newest first) ---------------------------
    if (pathname === '/api/gallery' && request.method === 'GET') {
      const list = await env.SKETCHES.list();
      const items = list.keys
        .filter((k) => k.metadata && k.metadata.public)
        .sort((a, b) => (b.metadata.created || 0) - (a.metadata.created || 0))
        .map((k) => ({ slug: k.name, created: k.metadata.created, title: k.metadata.title || '' }));
      return json({ items });
    }

    // --- Shared sketch page: serve the SPA shell ----------------------------
    // (Client reads the slug from the URL and fetches /api/sketch/:slug.
    //  OG-meta injection via HTMLRewriter is a later step.)
    if (pathname.startsWith('/s/')) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    // --- Everything else → static assets (SPA fallback) ---------------------
    return env.ASSETS.fetch(request);
  },
};
