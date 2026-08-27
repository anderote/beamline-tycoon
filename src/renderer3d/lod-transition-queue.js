// Frame-budgeted world-LOD visibility coordinator. A boundary crossing can
// make thousands of already-built meshes newly visible. Although each
// visibility setter is cheap on the CPU, admitting every family to one WebGPU
// render creates a large synchronous submission cliff. This queue exposes one
// family per admitted render frame and replaces stale work when the camera
// reverses direction.

export class LodTransitionQueue {
  constructor() {
    this._target = null;
    this._steps = [];
  }

  schedule(target, steps = []) {
    this._target = target;
    this._steps = steps
      .filter(step => typeof step?.apply === 'function')
      .map(step => ({ id: step.id || '', group: step.group || '', apply: step.apply }));
    return this._steps.length;
  }

  replaceGroup(group, steps = []) {
    this._steps = this._steps.filter(step => step.group !== group);
    this._steps.push(...steps
      .filter(step => typeof step?.apply === 'function')
      .map(step => ({ id: step.id || '', group, apply: step.apply })));
    return this._steps.length;
  }

  enqueue(step) {
    if (typeof step?.apply !== 'function') return this._steps.length;
    const id = step.id || '';
    if (id) this._steps = this._steps.filter(candidate => candidate.id !== id);
    this._steps.push({ id, group: step.group || '', apply: step.apply });
    return this._steps.length;
  }

  remove(id) {
    const previous = this._steps.length;
    this._steps = this._steps.filter(step => step.id !== id);
    return previous - this._steps.length;
  }

  removeGroup(group) {
    const previous = this._steps.length;
    this._steps = this._steps.filter(step => step.group !== group);
    return previous - this._steps.length;
  }

  advance() {
    const step = this._steps.shift();
    if (!step) return null;
    step.apply();
    return step.id;
  }

  flush() {
    const applied = [];
    let id;
    while ((id = this.advance()) !== null) applied.push(id);
    return applied;
  }

  cancel() {
    this._steps.length = 0;
  }

  get pendingCount() {
    return this._steps.length;
  }

  get target() {
    return this._target;
  }
}

export default LodTransitionQueue;
