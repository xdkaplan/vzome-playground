// Builds the curated "magic API" that is injected into the user's script scope.
// Thin by design: it wraps the engine into a small, ergonomic surface and
// nothing more. Whatever the default triangle script needs defines this
// surface; we add to it only when a new script genuinely demands it.

// The output collector users push geometry into. Its shape is the one custom,
// permanent piece of the API, so editor autocomplete derives from it too —
// see api-completions.js. Single definition, no duplication.
export function makeOut() {
  return {
    struts: [],
    balls: [],
    strut(a, b) { this.struts.push([a, b]); },
    ball(p) { this.balls.push(p); },
  };
}

export function buildFacade(engine) {
  const out = makeOut();

  const symmetry = {
    orbit: (name) => engine.orbit(name),
    catalog: () => engine.catalog(),
  };

  const globals = {
    field: engine.field,
    symmetry,
    out,
    input: null,
    origin: engine.origin(),
  };

  return { globals, out };
}
