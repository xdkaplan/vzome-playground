// Builds the curated "playground API" that is injected into the user's script scope.
// API completions are separate in api-completions.js
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
