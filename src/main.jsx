import { render } from 'solid-js/web';
import { Gallery } from './Gallery.jsx';
import { Playground } from './Playground.jsx';
import './style.css';

function App() {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/gallery' ? <Gallery /> : <Playground />;
}

render(() => <App />, document.getElementById('app'));
