// Shared physical presentation contract for the beam axis and its vacuum tube.
// This module deliberately has no renderer or data dependencies so simulation,
// input, previews, component builders, and the production pipe builder can all
// agree on the same dimensions without creating an import cycle.

export const BEAM_AXIS_HEIGHT = 1.0;
export const BEAM_PIPE_RADIUS = 0.08;
export const BEAM_FLANGE_RADIUS = 0.16;
export const BEAM_FLANGE_WIDTH = 0.045;
