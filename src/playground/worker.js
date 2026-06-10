// The execution worker: keeps script execution (and the heavy vZome engine,
// which loads asynchronously) off the main thread. Protocol:
//   in:  { type: 'RUN_SCRIPT', payload: { code, input } }
//   out: { type: 'ENGINE_READY' }                                   once loaded
//        { type: 'SCRIPT_RESULT', payload: { mesh, engine, edges, logs } }
//        { type: 'SCRIPT_ERROR',  payload: { message, stack, logs } }

import { createEngine } from './engine.js';
import { runScript } from './runner.js';

const enginePromise = createEngine();
// Tell the main thread when the engine has finished loading so it can show a
// "Loading vZome…" state for a Run that's waiting on it. (Load failures surface
// via SCRIPT_ERROR when a run awaits the rejected promise.)
enginePromise.then(() => self.postMessage({ type: 'ENGINE_READY' }), () => {});

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  if (type !== 'RUN_SCRIPT') return;

  const logs = [];
  try {
    const engine = await enginePromise;
    const mesh = runScript(payload.code, engine, payload.input, (line) => logs.push(line));
    const meshText = JSON.stringify(mesh);
    self.postMessage({
      type: 'SCRIPT_RESULT',
      payload: { mesh: meshText, engine: engine.name, edges: mesh.edges?.length ?? 0, logs },
    });
  } catch (err) {
    self.postMessage({
      type: 'SCRIPT_ERROR',
      payload: { message: err.message, stack: err.stack, logs },
    });
  }
};
