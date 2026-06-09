# vZome Playground

Write and run JavaScript against vZome's APIs, in the browser.

Write a script, hit **Run**, get a mesh — view it, **Export**, or **Copy**. The
default script finds all closed triangles in the golden (icosahedral) field.
Input files are optional.

## Magic API

Injected into every script (no imports):

| Name       | What it is                                          |
|------------|-----------------------------------------------------|
| `field`    | the algebraic field (golden ratio)                  |
| `symmetry` | symmetry group: `.orbit(name).axes()`, `.catalog()` |
| `out`      | output: `out.strut(a, b)`, `out.ball(p)`            |
| `input`    | the loaded input model, or `null`                   |
| `origin`   | the zero vector                                      |

Axes have `.vector()`; vectors support `.plus(v)`, `.times(n)`, `.isZero()`.

## Structure

```
src/main.jsx           UI shell (SolidJS + SUID)
src/defaultScript.js   the default sandbox script
src/docs/*.md          per-sandbox docs
src/playground/
  worker.js    runs scripts off the main thread
  runner.js    scope-injects the magic API
  facade.js    the magic API surface
  engine.js    geometry — toy placeholder + seam for the real vZome engine
```

The engine is a toy placeholder; the real vZome golden-field engine swaps in at
`createEngine()` in `engine.js`.

## Develop

```
npm install
npm run dev
```

## Deploy

Static SPA — `npm run build` outputs `dist/`. To Cloudflare:

```
npm run deploy        # Workers static assets (see wrangler.toml)
```

Or connect the repo to Cloudflare Pages (build command `npm run build`,
output directory `dist`).
