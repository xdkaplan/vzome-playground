import { render } from 'solid-js/web';
import { lazy, Suspense } from 'solid-js';
import './style.css';

// Route-level code splitting: each view is its own chunk, so /gallery doesn't pull
// in the editor / dialogs / worker, and the sketch page doesn't pull in the grid.
// (Named exports → unwrap to the { default } shape lazy() expects.)
const Gallery = lazy(() => import('./Gallery.jsx').then((m) => ({ default: m.Gallery })));
const Playground = lazy(() => import('./Playground.jsx').then((m) => ({ default: m.Playground })));

function App() {
  const path = location.pathname.replace(/\/$/, '');
  return (
    <Suspense>
      {path === '/gallery' ? <Gallery /> : <Playground />}
    </Suspense>
  );
}

render(() => <App />, document.getElementById('app'));
