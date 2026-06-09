// Find every closed triangle: three strut directions summing to zero.
// In scope: field, symmetry, out, input, origin.
// Axes have .vector(); vectors support .plus(v), .times(n), .isZero().

const catalog = symmetry.catalog();
const blue   = symmetry.orbit('blue').axes();
const yellow = symmetry.orbit('yellow').axes();
const red    = symmetry.orbit('red').axes();

let found = 0;
for (const b of blue)
  for (const y of yellow)
    for (const r of red) {
      if (!b.vector().plus(y.vector()).plus(r.vector()).isOrigin()) continue;
      if (!catalog.add([b, y, r])) continue; // skip symmetry duplicates

      const p1 = b.vector();
      const p2 = p1.plus(y.vector());
      out.strut(origin, p1);
      out.strut(p1, p2);
      out.strut(p2, origin);
      found++;
    }

for (const b of blue) {
  out.strut(origin, b.vector());
}

console.log(`found ${found} closed triangles`);
