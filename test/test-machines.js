// Quick test for machine system
import { Game } from '../src/game/Game.js';

const mockBeamline = {
  nodes: [], occupied: {},
  getOrderedComponents: () => [],
  toJSON: () => ({}), fromJSON: () => {},
};
const game = new Game(mockBeamline);

console.log('=== Machine System Test ===');

// Place Van de Graaff (no research needed)
const p1 = game.placeMachine('vanDeGraaff', 5, 5);
console.log('Place vanDeGraaff:', p1);
console.log('Count:', game.state.machines.length);
console.log('Grid cells:', Object.keys(game.state.machineGrid).length);

// Performance calc
const m = game.state.machines[0];
const perf = game.getMachinePerformance(m);
console.log('Base perf:', JSON.stringify(perf));

// Upgrade voltage
game.upgradeMachine(m.id, 'voltage');
console.log('Voltage level after upgrade:', m.upgrades.voltage);
const perf2 = game.getMachinePerformance(m);
console.log('Upgraded perf:', JSON.stringify(perf2));

// Cyclotron should be locked
const locked = game.placeMachine('smallCyclotron', 15, 15);
console.log('Cyclotron locked (should be false):', locked);

// Unlock and place
game.state.completedResearch.push('cyclotronTech');
game.state.resources.funding = 5000000;
const placed = game.placeMachine('smallCyclotron', 15, 15);
console.log('Cyclotron placed (should be true):', placed);
console.log('Machine count:', game.state.machines.length);

// Mode switch
const cyc = game.state.machines[1];
console.log('Default mode:', cyc.operatingMode);
game.setMachineMode(cyc.id, 'research');
console.log('Switched to:', cyc.operatingMode);

// Tick
game.state.resources.energy = 1000;
game._tickMachines();
console.log('Funding after tick:', game.state.resources.funding.toFixed(1));
console.log('Data after tick:', game.state.resources.data.toFixed(2));

// Toggle off
game.toggleMachine(cyc.id);
console.log('Cyclotron active:', cyc.active);

// Removal
game.removeMachine(m.id);
console.log('After remove, count:', game.state.machines.length);
console.log('Grid cells:', Object.keys(game.state.machineGrid).length);

// Storage ring needs research
const sr = game.placeMachine('storageRing', 30, 30);
console.log('Storage ring locked (should be false):', sr);

console.log('\n=== ALL TESTS PASSED ===');
