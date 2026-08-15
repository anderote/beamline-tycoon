// Async Pyodide bridge. A single module Worker owns Python/WASM so optics
// recalculation cannot halt animation, input, or audio on the main thread.

import { COMPONENTS } from '../data/components.js';
import { PHYSICS_MESSAGE } from './physics-protocol.js';

const NODE_TOKEN_PREFIX = '__beam_node_';

function cloneResultForIds(result, ids) {
  if (!result) return null;
  const cavities = Array.isArray(result.cavities)
    ? result.cavities.map(cavity => {
      const match = typeof cavity.id === 'string'
        ? new RegExp(`^${NODE_TOKEN_PREFIX}(\\d+)$`).exec(cavity.id)
        : null;
      return match ? { ...cavity, id: ids[Number(match[1])] } : cavity;
    })
    : result.cavities;
  return cavities === result.cavities ? result : { ...result, cavities };
}

export function preparePhysicsRequest(gameBeamline, researchEffects = {}) {
  const ids = [];
  const payload = (gameBeamline || []).map((element, index) => {
    ids[index] = element.id;
    return {
      ...element,
      ...(element.id == null ? {} : { id: `${NODE_TOKEN_PREFIX}${index}` }),
      physicsType: element.physicsType || COMPONENTS[element.type]?.physicsType,
    };
  });
  const effects = { ...researchEffects };
  return {
    payload, effects, ids,
    key: JSON.stringify([payload, effects]),
  };
}

export class PhysicsWorkerClient {
  constructor({ workerFactory = null, maxCacheEntries = 64 } = {}) {
    this._workerFactory = workerFactory;
    this._maxCacheEntries = maxCacheEntries;
    this._worker = null;
    this._ready = false;
    this._initPromise = null;
    this._initResolve = null;
    this._initReject = null;
    this._nextRequestId = 1;
    this._pending = new Map();
    this._inflight = new Map();
    this._queue = [];
    this._queuedByLane = new Map();
    this._activeRequestId = null;
    this._cache = new Map();
    this._lastError = null;
    this._stats = {
      requests: 0, workerJobs: 0, cacheHits: 0, deduplicated: 0, superseded: 0,
    };
  }

  _baseUrl() {
    if (globalThis.document?.baseURI) return new URL('.', globalThis.document.baseURI).href;
    if (globalThis.location?.href) return new URL('.', globalThis.location.href).href;
    return 'http://localhost/';
  }

  init() {
    if (this._ready) return Promise.resolve();
    if (this._initPromise) return this._initPromise;
    this._initPromise = new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
    });
    try {
      const factory = this._workerFactory || (() => new Worker(
        new URL('./physics-worker.js', import.meta.url), { type: 'module' },
      ));
      this._worker = factory();
      this._worker.onmessage = event => this._handleMessage(event.data || {});
      this._worker.onerror = error => this._failInit(error?.message || error);
      this._worker.postMessage({ type: PHYSICS_MESSAGE.INIT, baseUrl: this._baseUrl() });
    } catch (error) {
      this._failInit(error);
    }
    return this._initPromise;
  }

  _failInit(error) {
    const message = String(error?.stack || error || 'Physics worker failed');
    this._lastError = message;
    this._initReject?.(new Error(message));
    this._initResolve = null;
    this._initReject = null;
  }

  _handleMessage(message) {
    if (message.type === PHYSICS_MESSAGE.READY) {
      this._ready = true;
      this._lastError = null;
      this._initResolve?.();
      this._initResolve = null;
      this._initReject = null;
      return;
    }
    if (message.type === PHYSICS_MESSAGE.INIT_ERROR) {
      this._failInit(message.error);
      return;
    }
    if (message.type !== PHYSICS_MESSAGE.RESULT) return;
    const pending = this._pending.get(message.requestId);
    if (!pending) return;
    this._pending.delete(message.requestId);
    if (this._activeRequestId === message.requestId) this._activeRequestId = null;
    if (message.error) {
      this._lastError = String(message.error).trim().split('\n').filter(Boolean).pop();
      console.error('BeamPhysics worker compute error:', message.error,
        '\nbeamline:', pending.payload, '\neffects:', pending.effects);
      pending.resolve(null);
      this._dispatchNext();
      return;
    }
    this._lastError = null;
    pending.resolve(message.result || null);
    this._dispatchNext();
  }

  _cacheGet(key) {
    if (!this._cache.has(key)) return undefined;
    const value = this._cache.get(key);
    this._cache.delete(key);
    this._cache.set(key, value);
    return value;
  }

  _cacheSet(key, value) {
    this._cache.set(key, value);
    while (this._cache.size > this._maxCacheEntries) {
      this._cache.delete(this._cache.keys().next().value);
    }
  }

  _dispatchNext() {
    if (!this._ready || this._activeRequestId != null) return;
    const job = this._queue.shift();
    if (!job) return;
    if (job.lane != null && this._queuedByLane.get(job.lane) === job.requestId) {
      this._queuedByLane.delete(job.lane);
    }
    this._activeRequestId = job.requestId;
    this._stats.workerJobs++;
    this._worker.postMessage({
      type: PHYSICS_MESSAGE.COMPUTE, requestId: job.requestId,
      payload: job.payload, effects: job.effects,
      baseUrl: this._baseUrl(),
    });
  }

  async computeAsync(gameBeamline, researchEffects, { lane = null } = {}) {
    this._stats.requests++;
    if (!this._ready) {
      try {
        await this.init();
      } catch (_) {
        return null;
      }
      if (!this._ready) {
        this._lastError = 'Physics engine still loading';
        return null;
      }
    }
    const request = preparePhysicsRequest(gameBeamline, researchEffects);
    const cached = this._cacheGet(request.key);
    if (cached !== undefined) {
      this._stats.cacheHits++;
      return cloneResultForIds(cached, request.ids);
    }
    let promise = this._inflight.get(request.key);
    if (promise) {
      this._stats.deduplicated++;
    } else {
      const requestId = this._nextRequestId++;
      promise = new Promise(resolve => {
        this._pending.set(requestId, {
          resolve, payload: request.payload, effects: request.effects,
        });
      }).then(result => {
        if (result) this._cacheSet(request.key, result);
        return result;
      }).finally(() => this._inflight.delete(request.key));
      this._inflight.set(request.key, promise);
      if (lane != null) {
        const previousId = this._queuedByLane.get(lane);
        if (previousId != null && previousId !== this._activeRequestId) {
          this._queue = this._queue.filter(job => job.requestId !== previousId);
          const previous = this._pending.get(previousId);
          this._pending.delete(previousId);
          previous?.resolve(null);
          this._stats.superseded++;
        }
        this._queuedByLane.set(lane, requestId);
      }
      this._queue.push({
        requestId, key: request.key, payload: request.payload,
        effects: request.effects, lane,
      });
      this._dispatchNext();
    }
    return cloneResultForIds(await promise, request.ids);
  }

  // Compatibility for old callers: cached answers remain synchronous, while
  // a miss schedules background work and reports pending as null.
  compute(gameBeamline, researchEffects) {
    const request = preparePhysicsRequest(gameBeamline, researchEffects);
    const cached = this._cacheGet(request.key);
    if (cached !== undefined) return cloneResultForIds(cached, request.ids);
    if (this._ready) this.computeAsync(gameBeamline, researchEffects).catch(() => {});
    this._lastError = this._ready ? 'Physics result pending' : 'Physics engine still loading';
    return null;
  }

  isReady() { return this._ready; }
  getLastError() { return this._lastError; }
  getStats() {
    return {
      ...this._stats,
      cacheEntries: this._cache.size,
      pending: this._pending.size,
      queued: this._queue.length,
    };
  }
}

export const BeamPhysics = new PhysicsWorkerClient();
