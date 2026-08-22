// Presentation-only layouts for electrical distribution equipment. Breaker
// controls and branch-output terminals share readable rows across cabinet
// fronts. HV inputs retain their separately authored roof bushings.

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
  poleMountTransformer: Object.freeze({ count: 4, span: 0.60, bottomY: 0.58, frontZ: 0.43 }),
  compactHvDistributor: Object.freeze({ count: 2, span: 0.20, bottomY: 0.48, frontZ: 0.21 }),
  switchgear: Object.freeze({ count: 4, span: 0.60, bottomY: 0.58, frontZ: 0.66 }),
  powerPanel: Object.freeze({ count: 4, span: 0.30, bottomY: 0.38, frontZ: 0.19 }),
  sectionDistributionPanel: Object.freeze({ count: 8, span: 0.70, bottomY: 0.42, rowGap: 0.36, frontZ: 0.24 }),
  mainDistributionPanel: Object.freeze({ count: 8, span: 1.04, bottomY: 0.48, rowGap: 0.42, frontZ: 0.26 }),
  mcc: Object.freeze({ count: 8, span: 1.26, bottomY: 0.48, rowGap: 0.82, frontZ: 0.41 }),
  ups: Object.freeze({ count: 2, span: 0.72, bottomY: 0.84, frontZ: 0.41 }),
});

export const DISTRIBUTION_OUTPUT_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.entries(SPECS).map(([id, spec]) => [
    id,
    Object.freeze(horizontalOutputRows(spec.count, spec).map(Object.freeze)),
  ]),
));

// Exact front-face attachment points for cable anchors and visible metal
// glands. Keeping this derived from the breaker-row layout prevents controls,
// terminals, and independently selectable output ports from drifting apart.
export const DISTRIBUTION_FRONT_TERMINAL_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.entries(SPECS).map(([id, spec]) => [
    id,
    Object.freeze(horizontalOutputRows(spec.count, spec).map(({ x, y }) => Object.freeze({
      x, y, z: spec.frontZ,
    }))),
  ]),
));

export const DISTRIBUTION_TERMINAL_HEIGHT = 0.16;

function topInputLayout({ roofY, inputZ }) {
  return Object.freeze({
    roofY,
    input: Object.freeze({
      x: 0,
      y: roofY + DISTRIBUTION_TERMINAL_HEIGHT,
      z: inputZ,
    }),
  });
}

const TOP_INPUT_SPECS = Object.freeze({
  poleMountTransformer: Object.freeze({ roofY: 1.365, inputZ: -0.18 }),
  compactHvDistributor: Object.freeze({ roofY: 0.895, inputZ: -0.10 }),
  switchgear: Object.freeze({ roofY: 1.845, inputZ: -0.28 }),
  powerPanel: Object.freeze({ roofY: 1.465, inputZ: -0.10 }),
  sectionDistributionPanel: Object.freeze({ roofY: 1.765, inputZ: -0.16 }),
  mainDistributionPanel: Object.freeze({ roofY: 1.965, inputZ: -0.17 }),
  mcc: Object.freeze({ roofY: 1.915, inputZ: -0.15 }),
  ups: Object.freeze({ roofY: 1.92, inputZ: -0.14 }),
});

export const DISTRIBUTION_TOP_INPUT_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.entries(TOP_INPUT_SPECS).map(([id, spec]) => [id, topInputLayout(spec)]),
));
