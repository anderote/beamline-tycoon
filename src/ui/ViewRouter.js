// src/ui/ViewRouter.js — URL hash routing for view management.
// Routes: #game (default), #designer, #designer?edit=<id>, #designer?design=<id>, #designs

export class ViewRouter {
  constructor() {
    this.currentView = 'game';
    this.params = {};
    this.listeners = [];

    window.addEventListener('hashchange', () => this._onHashChange());
  }

  on(fn) { this.listeners.push(fn); }
  _emit(view, params) { this.listeners.forEach(fn => fn(view, params)); }

  init() {
    this._onHashChange();
  }

  _onHashChange() {
    const hash = window.location.hash.slice(1) || 'game';
    const [path, query] = hash.split('?');
    const params = {};
    if (query) {
      for (const pair of query.split('&')) {
        const [k, v] = pair.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      }
    }
    this.currentView = path;
    this.params = params;
    this._emit(path, params);
  }

  navigate(view, params = {}) {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const hash = query ? `${view}?${query}` : view;
    window.location.hash = hash;
  }

  get isDesigner() { return this.currentView === 'designer'; }
  get isDesigns() { return this.currentView === 'designs'; }
  get isGame() { return this.currentView === 'game' || !this.currentView; }
}
