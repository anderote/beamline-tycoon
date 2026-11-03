// Legacy builders read the Three namespace during module evaluation. Complete
// that initialization before evaluating any game/shared chunk, regardless of
// the bundler's choice of chunk boundaries for optional UI.
import './three-global.js';
await import('./main.js');
