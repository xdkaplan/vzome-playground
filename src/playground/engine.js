// Engine: provides the geometric primitives the curated facade exposes to user
// scripts. There are two implementations behind one contract:
//
//   - toyEngine: a small integer-vector placeholder so the whole pipeline runs
//     end-to-end today. It uses EXACT integer arithmetic (no floating point),
//     honoring vZome's core principle, but with a toy direction set and a
//     lexicographic dedup rather than the real 60-fold icosahedral group.
//
//   - vzomeEngine: the real golden-field engine, loaded from the vZome
//     online module bundle. The single integration seam is createEngine().
//
// Engine contract:
//   field                -> { name }
//   origin()             -> Vec
//   orbit(name)          -> { axes(): Axis[] }
//   catalog()            -> { add(axes: Axis[]): boolean }   // false if seen
//   buildMesh(struts)    -> mesh JSON   (struts: [Vec, Vec][])
// Vec:  { plus(Vec): Vec, times(n): Vec, isZero(): boolean, toString(): string }
// Axis: { vector(): Vec, id: string }

class IntVec {
  constructor(c) { this.c = c; }
  plus(v) { return new IntVec([this.c[0] + v.c[0], this.c[1] + v.c[1], this.c[2] + v.c[2]]); }
  times(n) { return new IntVec([this.c[0] * n, this.c[1] * n, this.c[2] * n]); }
  isZero() { return this.c[0] === 0 && this.c[1] === 0 && this.c[2] === 0; }
  toString() { return this.c.join(','); }
}

// A toy set of directions, grouped by "color", chosen so that closed triangles
// (one of each color summing to zero) genuinely exist.
const TOY_ORBITS = {
  blue: [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ],
  yellow: [
    [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0],
    [1, 0, 1], [-1, 0, -1], [0, 1, 1], [0, -1, -1],
  ],
  red: [
    [1, 1, 1], [-1, -1, -1], [1, 1, -1], [-1, -1, 1],
    [1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1],
  ],
};

function toyEngine() {
  return {
    name: 'toy (placeholder — real golden field pending)',
    field: { name: 'toy' },
    origin: () => new IntVec([0, 0, 0]),
    orbit(name) {
      const dirs = TOY_ORBITS[name];
      if (!dirs) throw new Error(`unknown orbit '${name}' (toy engine knows: ${Object.keys(TOY_ORBITS).join(', ')})`);
      const axes = dirs.map((c, i) => ({ vector: () => new IntVec(c), id: `${name}:${i}` }));
      return { axes: () => axes };
    },
    catalog() {
      const seen = new Set();
      return {
        add(axes) {
          // toy canonicalization: sort the member vectors so the same triangle
          // found in a different loop order dedups. The real engine will
          // canonicalize under the full icosahedral symmetry group instead.
          const k = axes.map((a) => a.vector().toString()).sort().join('|');
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        },
      };
    },
    buildMesh(struts) {
      const vertices = [];
      const index = new Map();
      const vid = (v) => {
        const k = v.toString();
        if (!index.has(k)) {
          index.set(k, vertices.length);
          vertices.push(v.c);
        }
        return index.get(k);
      };
      const edges = struts.map(([a, b]) => [vid(a), vid(b)]);
      return { field: 'toy', vertices, edges, faces: [] };
    },
  };
}


import { initialize } from 'https://www.vzome.com/modules/vzome-legacy.js';


// Single integration seam. Returns a promise so the real engine can load its
// module bundle / resources asynchronously when wired in.
export async function createEngine()
{
  return initialize() .then( api => {
    console.log('vZome API loaded:', api);
    const gField = api .getField( 'golden' );
    const scaleFactor = gField .createPower( 4, 1 );
    const icosahedralGroup = api .getSymmetry( 'golden', 'icosahedral' );
    return {
      name: 'vZome golden field',
      field: { name: 'golden' },
      origin: () => gField .origin( 3 ),
      orbit(name) {
        const orbit = icosahedralGroup .getDirection( name ) .iterator();
        if (!orbit) throw new Error(`unknown orbit '${name}' (toy engine knows: ${icosahedralGroup .getDirectionNames() .join(', ')})`);
        const zones = [];
        while (orbit .hasNext()) {
          const zone = orbit .next();
          zones .push( { vector: () => zone .normal(), id: name + ':' + zones.length });
        }
        return { axes: () => zones };
      },
      catalog() {
        const seen = new Set();
        return {
          add(axes) {
            // toy canonicalization: sort the member vectors so the same triangle
            // found in a different loop order dedups. The real engine will
            // canonicalize under the full icosahedral symmetry group instead.
            const k = axes.map((a) => a.vector().toString()).sort().join('|');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          },
        };
      },
      buildMesh(struts) {
        const vertexArray = [];
        const index = new Map();
        const vid = (v) => {
          const k = v.toString();
          if (!index.has(k)) {
            index.set(k, vertexArray.length);
            vertexArray.push( v .scale( scaleFactor ) );
          }
          return index.get(k);
        };
        const edges = struts.map(([a, b]) => [vid(a), vid(b)]);
        const vertices = vertexArray .map( vertex => {
          const xyzANs = vertex .getComponents();
          // toTD returns an array of strings, and we want actual BigInts
          return xyzANs .map( an => an.toTrailingDivisor() .map( str => BigInt( str ) ) );
        } );
        return { field: 'golden', vertices, edges, faces: [] };
      },
    };
  } );
}
