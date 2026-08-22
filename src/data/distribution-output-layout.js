// Presentation-only layouts for electrical distribution equipment. The first
// table arranges breaker controls into readable rows across cabinet fronts.
// The second is the physical terminal contract: cable anchors and the visible
// insulator/cap geometry both read the same roof coordinates.

/**
 * Lay out `count` outputs from the bottom up, with at most four per row.
 * Six-way banks become 4+2 and eight-way banks become 4+4; a shorter final
 * row is centred over the full-width rows.
 */
export function horizontalOutputRows(count, { span, bottomY, rowGap = 0 }) {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(span)
      || !Number.isFinite(bottomY) || !Number.isFinite(rowGap)) {
    throw new TypeError('horizontal output rows require a positive count and finite dimensions');
  }

  const positions = [];
  let remaining = count;
  let row = 0;
  while (remaining > 0) {
    const rowCount = Math.min(4, remaining);
    for (let col = 0; col < rowCount; col++) {
      positions.push({
        x: rowCount === 1 ? 0 : -span / 2 + col * (span / (rowCount - 1)),
        y: bottomY + row * rowGap,
      });
    }
    remaining -= rowCount;
    row++;
  }
  return positions;
}

const SPECS = Object.freeze({
  poleMountTransformer: Object.freeze({ count: 4, span: 0.60, bottomY: 0.58 }),
  compactHvDistributor: Object.freeze({ count: 2, span: 0.20, bottomY: 0.48 }),
  switchgear: Object.freeze({ count: 4, span: 0.60, bottomY: 0.58 }),
  powerPanel: Object.freeze({ count: 4, span: 0.30, bottomY: 0.38 }),
  sectionDistributionPanel: Object.freeze({ count: 8, span: 0.70, bottomY: 0.42, rowGap: 0.36 }),
  mainDistributionPanel: Object.freeze({ count: 8, span: 1.04, bottomY: 0.48, rowGap: 0.42 }),
  mcc: Object.freeze({ count: 8, span: 1.26, bottomY: 0.48, rowGap: 0.82 }),
  ups: Object.freeze({ count: 2, span: 0.72, bottomY: 0.84 }),
});

export const DISTRIBUTION_OUTPUT_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.entries(SPECS).map(([id, spec]) => [
    id,
    Object.freeze(horizontalOutputRows(spec.count, spec).map(Object.freeze)),
  ]),
));

export const DISTRIBUTION_TERMINAL_HEIGHT = 0.16;

function roofTerminalLayout(type, {
  roofY, inputZ, outputFrontZ, outputRowGap,
}) {
  const outputs = DISTRIBUTION_OUTPUT_LAYOUTS[type].map(({ x }, index) => Object.freeze({
    x,
    y: roofY + DISTRIBUTION_TERMINAL_HEIGHT,
    z: outputFrontZ - Math.floor(index / 4) * outputRowGap,
  }));
  return Object.freeze({
    roofY,
    input: Object.freeze({
      x: 0,
      y: roofY + DISTRIBUTION_TERMINAL_HEIGHT,
      z: inputZ,
    }),
    outputs: Object.freeze(outputs),
  });
}

const ROOF_SPECS = Object.freeze({
  poleMountTransformer: Object.freeze({
    roofY: 1.365, inputZ: -0.18, outputFrontZ: 0.18, outputRowGap: 0.12,
  }),
  compactHvDistributor: Object.freeze({
    roofY: 0.895, inputZ: -0.10, outputFrontZ: 0.10, outputRowGap: 0.10,
  }),
  switchgear: Object.freeze({
    roofY: 1.845, inputZ: -0.28, outputFrontZ: 0.28, outputRowGap: 0.18,
  }),
  powerPanel: Object.freeze({
    roofY: 1.465, inputZ: -0.10, outputFrontZ: 0.10, outputRowGap: 0.09,
  }),
  sectionDistributionPanel: Object.freeze({
    roofY: 1.765, inputZ: -0.16, outputFrontZ: 0.14, outputRowGap: 0.13,
  }),
  mainDistributionPanel: Object.freeze({
    roofY: 1.965, inputZ: -0.17, outputFrontZ: 0.15, outputRowGap: 0.14,
  }),
  mcc: Object.freeze({
    roofY: 1.915, inputZ: -0.15, outputFrontZ: 0.14, outputRowGap: 0.13,
  }),
  ups: Object.freeze({
    roofY: 1.92, inputZ: -0.14, outputFrontZ: 0.14, outputRowGap: 0.12,
  }),
});

export const DISTRIBUTION_TOP_TERMINAL_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.entries(ROOF_SPECS).map(([id, spec]) => [id, roofTerminalLayout(id, spec)]),
));
