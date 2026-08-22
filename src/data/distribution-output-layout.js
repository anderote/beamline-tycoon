// Presentation-only layouts for electrical distribution equipment. Breaker
// controls and branch-output terminals share readable rows across cabinet
// fronts. HV inputs retain their separately authored roof bushings.

/**
 * Lay out `count` outputs from the bottom up. Banks default to four per row,
 * while compact cabinets may request a narrower grid. A shorter final row is
 * centred over the full-width rows.
 */
export function horizontalOutputRows(count, {
  span, bottomY, rowGap = 0, maxPerRow = 4,
}) {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(span)
      || !Number.isFinite(bottomY) || !Number.isFinite(rowGap)
      || !Number.isInteger(maxPerRow) || maxPerRow < 1) {
    throw new TypeError('horizontal output rows require a positive count and finite dimensions');
  }

  const positions = [];
  let remaining = count;
  let row = 0;
  while (remaining > 0) {
    const rowCount = Math.min(maxPerRow, remaining);
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

const POWER_OUTPUT_SPECS = Object.freeze({
  poleMountTransformer: Object.freeze({ count: 4, span: 0.45, bottomY: 0.16, frontZ: 0.31 }),
  powerPanel: Object.freeze({
    count: 4, maxPerRow: 2, span: 0.20, bottomY: 0.30, rowGap: 0.20, frontZ: 0.21,
  }),
  sectionDistributionPanel: Object.freeze({ count: 6, span: 0.70, bottomY: 0.38, rowGap: 0.32, frontZ: 0.24 }),
  mainDistributionPanel: Object.freeze({ count: 12, span: 1.04, bottomY: 0.32, rowGap: 0.34, frontZ: 0.26 }),
  mcc: Object.freeze({ count: 8, span: 1.26, bottomY: 0.48, rowGap: 0.82, frontZ: 0.41 }),
  ups: Object.freeze({ count: 2, span: 0.72, bottomY: 0.84, frontZ: 0.41 }),
});

const HV_OUTPUT_SPECS = Object.freeze({
  compactHvDistributor: Object.freeze({
    count: 2, maxPerRow: 1, span: 0.20, bottomY: 0.36, rowGap: 0.20, frontZ: 0.21,
  }),
  sectionDistributionPanel: Object.freeze({ count: 1, span: 0.70, bottomY: 1.08, frontZ: 0.24 }),
  mainDistributionPanel: Object.freeze({ count: 2, span: 0.48, bottomY: 1.40, frontZ: 0.26 }),
});

function layoutsFromSpecs(specs) {
  return Object.freeze(Object.fromEntries(Object.entries(specs).map(([id, spec]) => [
    id,
    Object.freeze(horizontalOutputRows(spec.count, spec).map(Object.freeze)),
  ])));
}

export const DISTRIBUTION_POWER_OUTPUT_LAYOUTS = layoutsFromSpecs(POWER_OUTPUT_SPECS);
export const DISTRIBUTION_HV_OUTPUT_LAYOUTS = layoutsFromSpecs(HV_OUTPUT_SPECS);

const DISTRIBUTION_TYPES = new Set([
  ...Object.keys(POWER_OUTPUT_SPECS),
  ...Object.keys(HV_OUTPUT_SPECS),
]);

export const DISTRIBUTION_OUTPUT_LAYOUTS = Object.freeze(Object.fromEntries(
  [...DISTRIBUTION_TYPES].map(id => [id, Object.freeze([
    ...(DISTRIBUTION_POWER_OUTPUT_LAYOUTS[id] || []),
    ...(DISTRIBUTION_HV_OUTPUT_LAYOUTS[id] || []),
  ])]),
));

// Exact front-face attachment points for cable anchors and visible metal
// glands. Keeping this derived from the breaker-row layout prevents controls,
// terminals, and independently selectable output ports from drifting apart.
export const DISTRIBUTION_FRONT_TERMINAL_LAYOUTS = Object.freeze(Object.fromEntries(
  [...DISTRIBUTION_TYPES].map(id => [
    id,
    Object.freeze(DISTRIBUTION_OUTPUT_LAYOUTS[id].map(({ x, y }) => Object.freeze({
      x, y, z: POWER_OUTPUT_SPECS[id]?.frontZ ?? HV_OUTPUT_SPECS[id].frontZ,
    }))),
  ]),
));

function terminalLayouts(layouts, specs) {
  return Object.freeze(Object.fromEntries(Object.entries(layouts).map(([id, positions]) => [
    id,
    Object.freeze(positions.map(({ x, y }) => Object.freeze({ x, y, z: specs[id].frontZ }))),
  ])));
}

export const DISTRIBUTION_POWER_FRONT_TERMINAL_LAYOUTS = terminalLayouts(
  DISTRIBUTION_POWER_OUTPUT_LAYOUTS, POWER_OUTPUT_SPECS,
);
export const DISTRIBUTION_HV_FRONT_TERMINAL_LAYOUTS = terminalLayouts(
  DISTRIBUTION_HV_OUTPUT_LAYOUTS, HV_OUTPUT_SPECS,
);

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
  poleMountTransformer: Object.freeze({ roofY: 0.39, inputZ: -0.25 }),
  compactHvDistributor: Object.freeze({ roofY: 0.895, inputZ: -0.10 }),
  powerPanel: Object.freeze({ roofY: 0.895, inputZ: -0.10 }),
  sectionDistributionPanel: Object.freeze({ roofY: 1.765, inputZ: -0.16 }),
  mainDistributionPanel: Object.freeze({ roofY: 1.965, inputZ: -0.17 }),
  mcc: Object.freeze({ roofY: 1.915, inputZ: -0.15 }),
  ups: Object.freeze({ roofY: 1.92, inputZ: -0.14 }),
});

export const DISTRIBUTION_TOP_INPUT_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.entries(TOP_INPUT_SPECS).map(([id, spec]) => [id, topInputLayout(spec)]),
));
