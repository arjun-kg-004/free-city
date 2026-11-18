import { GameState } from '../game/GameState.js';

const $ = (id) => document.getElementById(id);

const TIPS = [
  'Tip: press V anywhere outside to have one of your vehicles delivered to the nearest road.',
  'Tip: hold Space in a car for a handbrake drift.',
  'Tip: bicycles have 3 gears — press 1, 2 or 3. Hold Shift to pedal harder.',
  'Tip: food and coffee give you a sprint boost. Try Spice Garden on Market Street.',
  'Tip: shiny golden tokens are hidden all around the city. Each one is worth $25.',
  'Tip: the yellow beams are optional missions. Ignore them and just explore if you like.',
  'Tip: open the map with M and click anywhere to set a GPS route.',
  'Tip: in Settings you can switch which side of the road traffic drives on.',
];

/** Loading screen, main menu (with attract-mode city behind it) and pause menu. */
export class MainMenu {
  constructor(game) {
    this.game = game;
    this.tip = 0;
    $('btn-continue').onclick = () => this._click(() => game.startGame(true));
    $('btn-new').onclick = () => this._click(() => {
      if (GameState.hasSave()) {
        game.ui.confirm('Start a new game?', 'Your saved progress (money, vehicles, tokens) will be replaced.', 'Start new game', () => game.startGame(false));
      } else game.startGame(false);
    });
    $('btn-settings').onclick = () => this._click(() => game.ui.settings());
    $('btn-controls').onclick = () => this._click(() => game.ui.controls());
    const cr = $('btn-credits');
    if (cr) cr.onclick = () => this._click(() => game.ui.credits());
    $('btn-resume').onclick = () => this._click(() => game.resume());
    $('btn-map').onclick = () => this._click(() => { this.hidePause(); game.toggleMap(true); });
    $('btn-journal').onclick = () => this._click(() => game.ui.journal());
    $('btn-garage').onclick = () => this._click(() => game.ui.garage());
    $('btn-abandon').onclick = () => this._click(() => { game.missions.abandon(); this.refreshPause(); });
    $('btn-respawn').onclick = () => this._click(() => { game.respawn(); game.resume(); });
    $('btn-p-settings').onclick = () => this._click(() => game.ui.settings());
    $('btn-p-controls').onclick = () => this._click(() => game.ui.controls());
    $('btn-save').onclick = () => this._click(() => { const ok = game.save(); game.hud.toast(ok ? 'Game saved' : 'Could not save (storage blocked)', 1800); });
    $('btn-quit').onclick = () => this._click(() => game.quitToMenu());
    $('hud-menu-btn').onclick = () => game.pause();
  }

  _click(fn) {
    this.game.audio.click();
    fn();
  }

  setLoading(progress, text) {
    $('loading').classList.remove('hidden');
    $('load-fill').style.width = `${Math.round(progress * 100)}%`;
    if (text) $('load-text').textContent = text;
    if (progress === 0 || Math.random() < 0.15) $('load-tip').textContent = TIPS[this.tip++ % TIPS.length];
  }

  hideLoading() {
    $('loading').classList.add('hidden');
  }

  showMain() {
    $('main-menu').classList.remove('hidden');
    $('btn-continue').classList.toggle('hidden', !GameState.hasSave());
    $('btn-new').classList.toggle('primary', !GameState.hasSave());
  }

  hideMain() {
    $('main-menu').classList.add('hidden');
  }

  showPause() {
    $('pause').classList.remove('hidden');
    this.refreshPause();
  }

  refreshPause() {
    $('btn-abandon').classList.toggle('hidden', !this.game.missions.active);
  }

  hidePause() {
    $('pause').classList.add('hidden');
  }

  showError(msg) {
    $('loading').classList.add('hidden');
    $('error').classList.remove('hidden');
    $('error-text').textContent = msg;
  }
}
