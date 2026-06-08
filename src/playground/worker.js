// The execution worker: keeps script execution (and, later, the heavy vZome
// engine) off the main thread. Protocol:
//   in:  { type: 'RUN_SCRIPT', payload: { code, input } }
//   out: { type: 'SCRIPT_RESULT', payload: { mesh, engine, edges, logs } }
//        { type: 'SCRIPT_ERROR',  payload: { message, stack, logs } }

import { createEngine } from './engine.js';
import { runScript } from './runner.js';

const enginePromise = createEngine();

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  if (type !== 'RUN_SCRIPT') return;

  const logs = [];
  try {
    const engine = await enginePromise;
    const mesh = runScript(payload.code, engine, payload.input, (line) => logs.push(line));
    self.postMessage({
      type: 'SCRIPT_RESULT',
      payload: { mesh, engine: engine.name, edges: mesh.edges?.length ?? 0, logs },
    });
  } catch (err) {
    self.postMessage({
      type: 'SCRIPT_ERROR',
      payload: { message: err.message, stack: err.stack, logs },
    });
  }
};
