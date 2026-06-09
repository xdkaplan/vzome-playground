// Sea urchin: spike a strut out to every zome direction and cap each tip.
// In scope: symmetry (orbit), out (strut/ball), origin, field, input.

for (const color of ['blue', 'yellow', 'red'])
  for (const axis of symmetry.orbit(color).axes()) {
    const tip = axis.vector();
    out.strut(origin, tip);
    out.ball(tip);
  }
