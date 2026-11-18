import './style.css';
import { Game } from './game/Game.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl');
  } catch {
    return false;
  }
}

function showError(msg) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('error-text').textContent = msg;
}

async function boot() {
  if (!webglAvailable()) {
    showError('Your browser or device does not support WebGL, which is required to render the 3D city.');
    return;
  }
  const game = new Game(document.getElementById('app'));
  window.__game = game; // handy for debugging in the console
  try {
    await game.init();
  } catch (err) {
    console.error(err);
    showError(`Failed to start: ${err && err.message ? err.message : err}`);
  }
}

window.addEventListener('error', (e) => console.error('[Uncaught]', e.error || e.message));
boot();
