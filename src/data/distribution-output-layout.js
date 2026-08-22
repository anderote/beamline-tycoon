// Presentation-only layouts for output hardware on electrical distribution
// equipment. Simulation endpoints keep their authored sides and offsetAlong
// values; these coordinates arrange visible sockets and cable tails into
// readable horizontal rows across each cabinet's front.

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
  sectionDistributionPanel: Object.freeze({ count: 6, span: 0.70, bottomY: 0.42, rowGap: 0.36 }),
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
