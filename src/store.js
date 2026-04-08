export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Map();

  function get(key) { return state[key]; }

  function set(key, value) {
    state[key] = value;
    const fns = listeners.get(key);
    if (fns) fns.forEach(fn => fn(value));
  }

  function update(key, fn) { set(key, fn(state[key])); }

  function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  }

  function getState() { return state; }
  function setState(newState) { state = newState; }
  function notify(key) {
    const fns = listeners.get(key);
    if (fns) fns.forEach(fn => fn(state[key]));
  }

  return { get, set, update, subscribe, getState, setState, notify };
}
