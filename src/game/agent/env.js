import { Game } from '../Game.js';
import { BeamlineRegistry } from '../../beamline/BeamlineRegistry.js';
import { buildObservation } from './observation.js';
import * as A from './actions.js';

export class BeamlineTycoonEnv {
  constructor(opts = {}) {
    this.registry = new BeamlineRegistry();
    // seed must reach the Game constructor — terrain blobs and the starter
    // map are generated there, so setting it after the fact does nothing.
    this.game = new Game(this.registry, { seed: opts.seed ?? 0 });
    this.game.setDevMode(true);
    this.maxTicks = opts.maxTicks ?? 2000;
  }
  reset(seed = 0) {
    const r = new BeamlineRegistry();
    this.registry = r;
    this.game = new Game(r, { seed });
    this.game.setDevMode(true);
    return this.observe();
  }
  observe() {
    return buildObservation(this.game);
  }
  validActions() {
    return {
      buildRoom: ['controlRoom', 'cafeteria', 'officeSpace', 'rfLab', 'vacuumLab'],
      buildHallway: true,
      placeFurnishing: true,
      buildBeamline: true,
      buildInfra: true,
      hireStaff: (this.game.state.candidates?.length ?? 0) > 0,
      tick: true,
    };
  }
  step(action) {
    const g = this.game;
    let res;
    switch (action.type) {
      case 'buildRoom': res = A.buildRoom(g, action); break;
      case 'buildHallway': res = A.buildHallway(g, action); break;
      case 'placeFurnishing': res = A.placeFurnishing(g, action); break;
      case 'buildBeamline': res = A.buildBeamline(g, action); break;
      case 'buildInfra': res = A.buildInfra(g, action); break;
      case 'hireStaff': res = A.hireStaff(g, action.idx ?? 0); break;
      case 'tick': res = A.doTick(g, action.n ?? 1); break;
      case 'research': res = A.doResearch(g, action.id); break;
      case 'eval': res = Function('game', action.js)(g); break;
      default: res = { ok: false, reason: `unknown ${action.type}` };
    }
    const obs = this.observe();
    const reward = (g.state.resources.data ?? 0) * 0.01 - (res.ok ? 0 : 1);
    const done = g.state.tick >= this.maxTicks || g.state.resources.funding <= 0;
    return { observation: obs, reward, done, info: res };
  }
}
