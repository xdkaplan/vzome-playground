// Engine: provides the geometric primitives the curated facade exposes to user
// scripts, backed by the real vZome golden-field core loaded from the online
// module bundle. The single integration seam is createEngine().
//
// Engine contract:
//   field                -> { name }
//   origin()             -> Vec
//   orbit(name)          -> { axes(): Axis[] }
//   catalog()            -> { add(axes: Axis[]): boolean }   // false if seen
//   buildMesh(struts)    -> mesh JSON   (struts: [Vec, Vec][])
// Vec:  vZome AlgebraicVector — plus(Vec), scale(n), isOrigin(), toString()
// Axis: { vector(): Vec, id: string }

import { initialize } from 'https://www.vzome.com/modules/vzome-legacy.js';

// Single integration seam. Returns a promise so the engine can load its module
// bundle / resources asynchronously.
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
        if (!orbit) throw new Error(`unknown orbit '${name}' (known: ${icosahedralGroup .getDirectionNames() .join(', ')})`);
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
          // toTrailingDivisor returns an array of strings; convert to BigInts
          return xyzANs .map( an => an.toTrailingDivisor() .map( str => BigInt( str ) ) );
        } );
        return { field: 'golden', vertices, edges, faces: [] };
      },
    };
  } );
}
