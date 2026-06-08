// Builds the curated "magic API" that is injected into the user's script scope.
// Thin by design: it wraps the engine into a small, ergonomic surface and
// nothing more. Whatever the default triangle script needs defines this
// surface; we add to it only when a new script genuinely demands it.

export function buildFacade(engine) {
  const out = {
    struts: [],
    balls: [],
    strut(a, b) { this.struts.push([a, b]); },
    ball(p) { this.balls.push(p); },
  };

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
