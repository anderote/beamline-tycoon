// src/data/validate.js
//
// Content validator for the unified placeables/content pipeline. Pure —
// takes the registries as inputs and returns a list of problems; the
// caller (src/data/components.js) decides whether to throw (dev/node)
// or console.error (production).
//
// The requirement sets below are derived from how consumers actually read
// entries:
//   - Game.placePlaceable: canAfford/spend iterate cost entries → cost must
//     be an object of numeric resource amounts (a bare number silently
//     places for free).
//   - Placeable.footprintCells + renderers: subW/subL/subH positive numbers.
//   - hud palette: filters COMPONENTS/DECORATIONS by def.category against
//     MODES tab keys — an unknown category is invisible in every palette.
//   - facility palette: itemMatchesZone keys furnishings/equipment off
//     zoneType/zoneTypes against MODES.facility zone tabs.
//   - BeamlineSystem/Game routing: role 'junction' | 'placement'; routing
//     entries must reference declared beam ports.
//   - utility solver: sink needs come from the utility-ports-v2 table — a
//     component with requiredConnections but no matching sink port runs
//     forever unpowered/uncooled with no way to trip.
//   - beam_physics/gameplay.py: raises on missing/unknown physicsType; the
//     KNOWN_PHYSICS_TYPES mirror below must stay in sync (test/
//     test-content-validate.js parses gameplay.py and asserts equality).

import { MODES } from './modes.js';
import { UTILITY_TYPE_LIST } from '../utility/registry.js';

// Mirror of beam_physics/gameplay.py KNOWN_PHYSICS_TYPES. Kept as a JS
// constant so content validation runs without Python; the sync is guarded
// by test/test-content-validate.js.
export const KNOWN_PHYSICS_TYPES = new Set([
  'source', 'drift', 'quadrupole', 'dipole', 'combined_function',
  'rfCavity', 'cryomodule', 'sextupole', 'collimator', 'undulator',
  'solenoid', 'chicane', 'detector', 'target', 'beamStop',
]);

export const KNOWN_KINDS = new Set([
  'beamline', 'infrastructure', 'furnishing', 'equipment', 'decoration',
]);

// Closed vocabulary of staff job-type ids a `station` block may name. Kept
// here (rather than in the staff module) so content validation has no
// dependency on the staff sim; the station index (next plan task) imports
// this same set as its source of truth.
export const JOB_IDS = new Set([
  'runBeam', 'repair', 'labWork', 'commission', 'takeData', 'analyze',
  'fabricate', 'paperwork', 'meet', 'eat', 'rest', 'officeWork', 'privateOfficeWork',
]);
const STATION_SEATED_VALUES = new Set(['required', 'preferred', 'never']);
const FACINGS = new Set(['n', 'e', 's', 'w']);

const PORT_SIDES = new Set(['front', 'back', 'left', 'right']);
const PORT_ROLES = new Set(['source', 'sink', 'pass']);
const BEAMLINE_ROLES = new Set(['junction', 'placement']);
const PLACEMENTS = new Set(['module', 'attachment']);
const ATTACHMENT_KINDS = new Set(['inline']);
const LIGHT_MOUNTS = new Set(['ground', 'wall', 'overhead', 'surface']);
const LIGHT_SHAPES = new Set(['point', 'cone']);
const PART_SHAPES = new Set(['box', 'cylinder', 'sphere', 'torus', 'cone']);
const PART_AXES = new Set(['x', 'y', 'z']);

const BEAMLINE_CATEGORIES = new Set(Object.keys(MODES.beamline.categories));
const INFRA_CATEGORIES = new Set(Object.keys(MODES.infra.categories));
// Decoration tabs live wherever a category declares isDecorationTab: true —
// Grounds' free-standing fixtures (lighting, furniture, ...) AND Structure's
// wall/ceiling-mounted fixtures (structureLights), which are building fabric
// rather than landscaping. Scan every mode, not just grounds, so a category
// added under a different mode is still recognised here.
const DECORATION_CATEGORIES = new Set(
  Object.values(MODES).flatMap(mode =>
    Object.entries(mode.categories)
      .filter(([, c]) => c.isDecorationTab)
      .map(([key]) => key)),
);
const ZONE_TYPES = new Set(
  Object.values(MODES.facility.categories)
    .filter(c => c.isZoneTab && c.zoneType)
    .map(c => c.zoneType),
);
const UTILITIES = new Set(UTILITY_TYPE_LIST);

function subsectionsOf(modeKey, category) {
  const cat = MODES[modeKey]?.categories?.[category];
  return cat?.subsections ? new Set(Object.keys(cat.subsections)) : null;
}

/**
 * Beamline component ids that have no bespoke 3D geometry (no entry in the
 * renderer's ROLE_BUILDERS/DETAIL_BUILDERS maps) and therefore render as a
 * generic box/cylinder. Info-level visibility, never a validation problem.
 */
export function roleBuilderFallbacks(beamlineRaw, coveredIds) {
  const covered = new Set(coveredIds);
  return Object.keys(beamlineRaw || {}).filter(id => !covered.has(id));
}

/**
 * Validate all game content. Returns a list of {id, field, message}
 * problems; empty when the content is clean.
 *
 * @param {object} args
 * @param {Record<string, object>} args.placeables    PLACEABLES registry (id → def/Placeable)
 * @param {object} args.rawRegistries {beamline, infrastructure, roomFurnishings, labFurnishings, decorations}
 * @param {Record<string, object>} args.utilityPorts  UTILITY_PORTS_V2_BY_ID (id → {portName: spec})
 * @param {Iterable<string>} [args.roleBuilders]      Optional: covered builder ids —
 *   when given, emits a console.info coverage report for beamline components
 *   falling back to generic geometry.
 */
export function validateContent({ placeables = {}, rawRegistries = {}, utilityPorts = {}, roleBuilders } = {}) {
  const problems = [];
  const problem = (id, field, message) => problems.push({ id, field, message });

  const {
    beamline = {},
    infrastructure = {},
    roomFurnishings = {},
    labFurnishings = {},
    decorations = {},
  } = rawRegistries;

  // ── Cross-registry: duplicate ids ─────────────────────────────────
  const seen = new Map();
  for (const [regName, reg] of Object.entries({ beamline, infrastructure, roomFurnishings, labFurnishings, decorations })) {
    for (const id of Object.keys(reg)) {
      if (seen.has(id)) {
        problem(id, 'id', `duplicate id across registries: ${seen.get(id)} and ${regName}`);
      } else {
        seen.set(id, regName);
      }
    }
  }

  // ── Shared per-entry checks ───────────────────────────────────────
  function checkCommon(id, def) {
    if (def.id !== id) problem(id, 'id', `def.id '${def.id}' does not match registry key '${id}'`);
    if (typeof def.name !== 'string' || def.name.length === 0) {
      problem(id, 'name', 'missing or empty name');
    }
    // cost must be an object of numeric resource amounts — Game.canAfford/
    // spend iterate Object.entries(cost); a bare number silently means free.
    if (def.cost == null || typeof def.cost !== 'object' || Array.isArray(def.cost)) {
      problem(id, 'cost', `cost must be an object of {resource: amount}, got ${JSON.stringify(def.cost)}`);
    } else {
      for (const [res, amt] of Object.entries(def.cost)) {
        if (typeof amt !== 'number' || !Number.isFinite(amt) || amt < 0) {
          problem(id, 'cost', `cost.${res} must be a finite non-negative number, got ${JSON.stringify(amt)}`);
        }
      }
    }
  }

  function checkDims(id, def) {
    for (const field of ['subW', 'subL', 'subH']) {
      const v = def[field];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        problem(id, field, `${field} must be a positive number, got ${JSON.stringify(v)}`);
      }
    }
  }

  function checkCategory(id, def, allowed, label) {
    if (typeof def.category !== 'string' || def.category.length === 0) {
      problem(id, 'category', `missing category (expected one of: ${[...allowed].join(', ')})`);
    } else if (!allowed.has(def.category)) {
      problem(id, 'category', `unknown ${label} category '${def.category}' — not a palette tab (known: ${[...allowed].join(', ')})`);
    }
  }

  function checkSubsection(id, def, modeKey) {
    if (def.subsection == null) return; // optional — palette defaults to first subsection
    const subs = subsectionsOf(modeKey, def.category);
    if (subs && !subs.has(def.subsection)) {
      problem(id, 'subsection', `unknown subsection '${def.subsection}' for category '${def.category}' (known: ${[...subs].join(', ')})`);
    }
  }

  function checkRequiredConnections(id, def) {
    if (def.requiredConnections == null) return;
    if (!Array.isArray(def.requiredConnections)) {
      problem(id, 'requiredConnections', 'requiredConnections must be an array');
      return;
    }
    for (const u of def.requiredConnections) {
      if (!UTILITIES.has(u)) {
        problem(id, 'requiredConnections', `unknown utility '${u}' (known: ${[...UTILITIES].join(', ')})`);
      }
    }
  }

  // Assisted wiring still commits ordinary utility lines, so its authored
  // utility must exist and the device needs a real source connector to start
  // each promised run. autoConnectUtility defaults to powerCable for the
  // original low-voltage distribution panels.
  function checkAutoConnect(id, def) {
    if (def.autoConnectRadius == null && def.autoConnectUtility == null) return;
    const radius = def.autoConnectRadius;
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
      problem(id, 'autoConnectRadius', `autoConnectRadius must be a positive number, got ${JSON.stringify(radius)}`);
    }
    const utility = def.autoConnectUtility || 'powerCable';
    if (!UTILITIES.has(utility)) {
      problem(id, 'autoConnectUtility', `unknown utility '${utility}' (known: ${[...UTILITIES].join(', ')})`);
      return;
    }
    const ports = utilityPorts[id] || {};
    if (!Object.values(ports).some(port => port.utility === utility && port.role === 'source')) {
      problem(id, 'autoConnectUtility', `auto-connects '${utility}' but has no '${utility}' source port in utility-ports-v2.js`);
    }
  }

  // Every declared connection must have a matching sink port in the
  // utility-ports-v2 table, or the solver can never connect or gate it.
  // Applies to beamline AND infrastructure: an infrastructure unit with a
  // power requirement but no pwr_in contributes no demand to any network,
  // so a 40 kW panel can "feed" a 2000 kW gyrotron at 0% utilization while
  // the overlay still draws it a power hookup the player can never make.
  function checkSinkPortsForRequired(id, def) {
    if (!Array.isArray(def.requiredConnections)) return;
    const ports = utilityPorts[id] || {};
    for (const u of def.requiredConnections) {
      if (!UTILITIES.has(u)) continue; // already reported
      const hasSink = Object.values(ports).some(p => p.utility === u && p.role === 'sink');
      if (!hasSink) {
        problem(id, 'requiredConnections', `requires '${u}' but has no '${u}' sink port in utility-ports-v2.js — the utility solver can never connect or gate it`);
      }
    }
  }

  // Any def carrying a `light` block (facility lighting fixtures) must
  // declare a valid mount, a positive energyCost, and a positive pool
  // radius — the renderer, power aggregate and placement routing all read
  // these uniformly and never special-case individual fixture ids.
  function checkLight(id, def) {
    if (def.light == null) return;
    if (!LIGHT_MOUNTS.has(def.mount)) {
      problem(id, 'mount', `light-bearing def must declare mount (known: ${[...LIGHT_MOUNTS].join(', ')}), got ${JSON.stringify(def.mount)}`);
    }
    if (typeof def.energyCost !== 'number' || !Number.isFinite(def.energyCost) || def.energyCost <= 0) {
      problem(id, 'energyCost', `energyCost must be a positive number (kW), got ${JSON.stringify(def.energyCost)}`);
    }
    const { shape, radius, coneDeg, tiltDeg } = def.light;
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
      problem(id, 'light.radius', `light.radius must be a positive number, got ${JSON.stringify(radius)}`);
    }
    if (!LIGHT_SHAPES.has(shape)) {
      problem(id, 'light.shape', `light.shape must be 'point' or 'cone', got ${JSON.stringify(shape)}`);
    } else if (shape === 'cone') {
      if (typeof coneDeg !== 'number' || !Number.isFinite(coneDeg) || coneDeg <= 0) {
        problem(id, 'light.coneDeg', `cone lights require a positive coneDeg, got ${JSON.stringify(coneDeg)}`);
      }
      if (typeof tiltDeg !== 'number' || !Number.isFinite(tiltDeg)) {
        problem(id, 'light.tiltDeg', `cone lights require a numeric tiltDeg, got ${JSON.stringify(tiltDeg)}`);
      }
    }
  }

  // Authored facility parts default to boxes. Non-box primitives share the
  // same exact w/h/l bounding-box contract in EquipmentBuilder, so malformed
  // dimensions, axes, or rotations would otherwise produce invisible or NaN
  // meshes deep in the renderer.
  function checkParts(id, def) {
    if (def.parts == null) return;
    if (!Array.isArray(def.parts)) {
      problem(id, 'parts', `parts must be an array, got ${JSON.stringify(def.parts)}`);
      return;
    }
    def.parts.forEach((part, index) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        problem(id, `parts[${index}]`, `part must be an object, got ${JSON.stringify(part)}`);
        return;
      }
      const shape = part.shape || 'box';
      if (!PART_SHAPES.has(shape)) {
        problem(id, `parts[${index}].shape`,
          `unknown part shape '${shape}' (known: ${[...PART_SHAPES].join(', ')})`);
      }
      if (part.shape != null) {
        for (const field of ['w', 'h', 'l']) {
          const value = part[field];
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            problem(id, `parts[${index}].${field}`,
              `primitive part ${field} must be a positive number, got ${JSON.stringify(value)}`);
          }
        }
      }
      if (part.axis != null && !PART_AXES.has(part.axis)) {
        problem(id, `parts[${index}].axis`,
          `part axis must be one of ${[...PART_AXES].join(', ')}, got ${JSON.stringify(part.axis)}`);
      }
      if (part.rotation != null && (!Array.isArray(part.rotation)
          || part.rotation.length !== 3
          || part.rotation.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
        problem(id, `parts[${index}].rotation`,
          `part rotation must be three finite radians, got ${JSON.stringify(part.rotation)}`);
      }
      if (part.topScale != null && (shape !== 'cone'
          || typeof part.topScale !== 'number' || !Number.isFinite(part.topScale)
          || part.topScale < 0 || part.topScale > 1)) {
        problem(id, `parts[${index}].topScale`,
          `topScale is only valid on cones and must be in [0, 1], got ${JSON.stringify(part.topScale)}`);
      }
    });
  }

  // A `station` describes where a pawn stands or sits to do a job at a def,
  // and a `seat` marks a chair as sit-able (nav.js's def.seat passability
  // clause) plus the direction a seated pawn faces and the seat cushion's
  // own height (StaffPawns.js's seated hip placement — see seatY below). A
  // bad anchor, job id, or seat height would otherwise sit silently wrong
  // until it's visible in the running game, so it is caught here instead.
  // Chairs are matched to stations by adjacency, never worked directly, so
  // a def must never carry both blocks.
  function checkStation(id, def) {
    if (def.station == null && def.seat == null) return;
    if (def.station != null && def.seat != null) {
      problem(id, 'station', 'def carries both station and seat — chairs are matched to stations by adjacency, never worked directly');
    }
    if (def.seat != null) {
      if (!FACINGS.has(def.seat.facing)) {
        problem(id, 'seat.facing', `seat.facing must be one of ${[...FACINGS].join(', ')}, got ${JSON.stringify(def.seat.facing)}`);
      }
      // seatY is the seat cushion's own bottom-of-part y, in subtiles (the
      // same coordinate space `parts[].y` uses) — read directly off the
      // def's own 'seat' part, not guessed. StaffPawns.js uses it to lift a
      // seated pawn's hip to the CHAIR's actual seat height rather than to
      // a fixed, style-only guess (which drifts as soon as two chair tiers
      // don't share a seat height, or the figure style changes).
      if (typeof def.seat.seatY !== 'number' || !Number.isFinite(def.seat.seatY) || def.seat.seatY < 0) {
        problem(id, 'seat.seatY', `seat.seatY must be a non-negative number (subtiles, matching the def's own 'seat' part y), got ${JSON.stringify(def.seat.seatY)}`);
      }
    }
    if (def.station == null) return;
    const { jobs, slots, seated, anchors } = def.station;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      problem(id, 'station.jobs', 'station.jobs must be a non-empty array of job ids');
    } else {
      for (const j of jobs) {
        if (!JOB_IDS.has(j)) {
          problem(id, 'station.jobs', `unknown job id '${j}' (known: ${[...JOB_IDS].join(', ')})`);
        }
      }
    }
    const slotsOk = Number.isInteger(slots) && slots > 0;
    if (!slotsOk) {
      problem(id, 'station.slots', `station.slots must be a positive integer, got ${JSON.stringify(slots)}`);
    }
    if (!STATION_SEATED_VALUES.has(seated)) {
      problem(id, 'station.seated', `station.seated must be one of ${[...STATION_SEATED_VALUES].join(', ')}, got ${JSON.stringify(seated)}`);
    }
    if (!Array.isArray(anchors)) {
      problem(id, 'station.anchors', 'station.anchors must be an array');
      return;
    }
    if (slotsOk && anchors.length !== slots) {
      problem(id, 'station.anchors', `station.anchors.length (${anchors.length}) must match station.slots (${slots})`);
    }
    const subW = def.subW, subL = def.subL;
    const dimsKnown = typeof subW === 'number' && typeof subL === 'number';
    const seenAt = new Map();
    anchors.forEach((a, i) => {
      if (!a || typeof a.subCol !== 'number' || typeof a.subRow !== 'number') {
        problem(id, `station.anchors[${i}]`, `anchor must have numeric subCol/subRow, got ${JSON.stringify(a)}`);
        return;
      }
      if (!FACINGS.has(a.facing)) {
        problem(id, `station.anchors[${i}].facing`, `anchor.facing must be one of ${[...FACINGS].join(', ')}, got ${JSON.stringify(a.facing)}`);
      }
      // Two anchors on the same subtile would be two pawns standing/sitting
      // in the same spot.
      const key = a.subCol + ',' + a.subRow;
      if (seenAt.has(key)) {
        problem(id, `station.anchors[${i}]`, `anchor (${a.subCol},${a.subRow}) duplicates anchors[${seenAt.get(key)}] — two pawns cannot occupy the same subtile`);
      } else {
        seenAt.set(key, i);
      }
      if (!dimsKnown) return;
      const inside = a.subCol >= 0 && a.subCol < subW && a.subRow >= 0 && a.subRow < subL;
      if (inside) {
        problem(id, `station.anchors[${i}]`, `anchor (${a.subCol},${a.subRow}) lies inside the def's own ${subW}x${subL} footprint — unreachable, dead station`);
        return;
      }
      // An anchor must sit exactly one subtile beyond a single edge — the
      // other axis's coordinate must stay within the footprint's own range
      // on that edge, and `facing` must point back across that edge (into
      // the footprint), or a pawn ends up looking away from the object it's
      // supposedly working. See task-3-brief.md's dir/edge/facing table.
      const onZPlus = a.subRow === subL && a.subCol >= 0 && a.subCol < subW;
      const onZMinus = a.subRow === -1 && a.subCol >= 0 && a.subCol < subW;
      const onXPlus = a.subCol === subW && a.subRow >= 0 && a.subRow < subL;
      const onXMinus = a.subCol === -1 && a.subRow >= 0 && a.subRow < subL;
      const expectedFacing = onZPlus ? 'n' : onZMinus ? 's' : onXPlus ? 'w' : onXMinus ? 'e' : null;
      if (expectedFacing == null) {
        problem(id, `station.anchors[${i}]`, `anchor (${a.subCol},${a.subRow}) is not immediately outside the def's own ${subW}x${subL} footprint — must sit exactly one subtile beyond a single edge`);
      } else if (FACINGS.has(a.facing) && a.facing !== expectedFacing) {
        problem(id, `station.anchors[${i}].facing`, `anchor (${a.subCol},${a.subRow}) sits just outside the footprint but faces '${a.facing}' instead of '${expectedFacing}' — the pawn would look away from the object`);
      }
    });
  }

  function checkBeamPorts(id, def) {
    if (def.ports == null) return;
    for (const [portName, spec] of Object.entries(def.ports)) {
      if (!spec || !PORT_SIDES.has(spec.side)) {
        problem(id, `ports.${portName}`, `invalid side '${spec?.side}' (known: ${[...PORT_SIDES].join(', ')})`);
      }
    }
  }

  function checkBetaAcceptance(id, def) {
    if (def.betaAcceptance == null) return;
    const window = def.betaAcceptance;
    if (typeof window !== 'object' || Array.isArray(window)) {
      problem(id, 'betaAcceptance', 'must be {min, design, max}');
      return;
    }
    for (const field of ['min', 'design', 'max']) {
      const value = window[field];
      if (typeof value !== 'number' || !Number.isFinite(value)
          || value <= 0 || value > 1) {
        problem(id, `betaAcceptance.${field}`,
          `${field} must be a finite number in (0, 1], got ${JSON.stringify(value)}`);
      }
    }
    if (Number.isFinite(window.min) && Number.isFinite(window.design)
        && Number.isFinite(window.max)
        && !(window.min <= window.design && window.design <= window.max)) {
      problem(id, 'betaAcceptance', 'must satisfy min <= design <= max');
    }
    if (window.tracksBeam != null && typeof window.tracksBeam !== 'boolean') {
      problem(id, 'betaAcceptance.tracksBeam', 'tracksBeam must be boolean when present');
    }
  }

  // ── Beamline raw entries (modules + attachments + drawn connections) ──
  for (const [id, def] of Object.entries(beamline)) {
    checkCommon(id, def);
    checkDims(id, def);
    checkCategory(id, def, BEAMLINE_CATEGORIES, 'beamline');
    checkSubsection(id, def, 'beamline');

    if (!PLACEMENTS.has(def.placement)) {
      problem(id, 'placement', `placement must be 'module' or 'attachment', got ${JSON.stringify(def.placement)}`);
    }
    if (def.attachmentKind != null) {
      if (!ATTACHMENT_KINDS.has(def.attachmentKind)) {
        problem(id, 'attachmentKind', `unknown attachmentKind ${JSON.stringify(def.attachmentKind)} (known: ${[...ATTACHMENT_KINDS].join(', ')})`);
      }
      if (def.placement !== 'attachment' || def.role !== 'placement') {
        problem(id, 'attachmentKind', 'attachmentKind requires placement \'attachment\' and role \'placement\'');
      }
    }

    // Physics identity — gameplay.py raises at compute time; catch at load.
    if (typeof def.physicsType !== 'string' || def.physicsType.length === 0) {
      problem(id, 'physicsType', 'missing physicsType — every beamline component must declare its physics identity');
    } else if (!KNOWN_PHYSICS_TYPES.has(def.physicsType)) {
      problem(id, 'physicsType', `unknown physicsType '${def.physicsType}' (known: ${[...KNOWN_PHYSICS_TYPES].sort().join(', ')})`);
    }

    // Role/routing shape. Drawn connections (drift) carry no role.
    if (def.placement === 'module' && !def.isDrawnConnection) {
      if (!BEAMLINE_ROLES.has(def.role)) {
        problem(id, 'role', `module must declare role 'junction' or 'placement', got ${JSON.stringify(def.role)}`);
      }
      if (def.ports == null || typeof def.ports !== 'object' || Object.keys(def.ports).length === 0) {
        problem(id, 'ports', 'module must declare at least one beam port');
      }
    } else if (def.role != null && !BEAMLINE_ROLES.has(def.role)) {
      problem(id, 'role', `unknown role ${JSON.stringify(def.role)}`);
    }
    checkBeamPorts(id, def);
    checkBetaAcceptance(id, def);
    if (def.routing != null) {
      if (!Array.isArray(def.routing)) {
        problem(id, 'routing', 'routing must be an array of {from, to}');
      } else {
        const portNames = new Set(Object.keys(def.ports || {}));
        def.routing.forEach((r, i) => {
          for (const end of ['from', 'to']) {
            if (!r || !portNames.has(r[end])) {
              problem(id, `routing[${i}].${end}`, `references undeclared port '${r?.[end]}' (declared: ${[...portNames].join(', ') || 'none'})`);
            }
          }
        });
      }
    }

    checkRequiredConnections(id, def);
    checkSinkPortsForRequired(id, def);
  }

  // ── Infrastructure raw entries ────────────────────────────────────
  for (const [id, def] of Object.entries(infrastructure)) {
    checkCommon(id, def);
    checkAutoConnect(id, def);
    checkDims(id, def);
    checkCategory(id, def, INFRA_CATEGORIES, 'infra');
    checkSubsection(id, def, 'infra');
    if (!PLACEMENTS.has(def.placement)) {
      problem(id, 'placement', `placement must be 'module' or 'attachment', got ${JSON.stringify(def.placement)}`);
    }
    checkRequiredConnections(id, def);
    checkSinkPortsForRequired(id, def);
    checkBeamPorts(id, def);
  }

  // ── Furnishings + equipment (zone-scoped) ─────────────────────────
  for (const reg of [roomFurnishings, labFurnishings]) {
    for (const [id, def] of Object.entries(reg)) {
      checkCommon(id, def);
      const zones = def.zoneTypes ?? (def.zoneType != null ? [def.zoneType] : null);
      if (!Array.isArray(zones) || zones.length === 0) {
        problem(id, 'zoneType', 'missing zoneType/zoneTypes — item would appear in no facility palette');
      } else {
        for (const z of zones) {
          if (!ZONE_TYPES.has(z)) {
            problem(id, 'zoneType', `unknown zone type '${z}' (known: ${[...ZONE_TYPES].join(', ')})`);
          }
        }
      }
    }
  }

  // ── Decorations ───────────────────────────────────────────────────
  for (const [id, def] of Object.entries(decorations)) {
    checkCommon(id, def);
    checkCategory(id, def, DECORATION_CATEGORIES, 'decoration');
  }

  // ── PLACEABLES wrapper layer ──────────────────────────────────────
  for (const [id, p] of Object.entries(placeables)) {
    if (!KNOWN_KINDS.has(p.kind)) {
      problem(id, 'kind', `unknown kind '${p.kind}' (known: ${[...KNOWN_KINDS].join(', ')})`);
    }
    checkDims(id, p);
    checkLight(id, p);
    checkParts(id, p);
    // Lighting fixtures (src/data/placeables/lighting.js) are authored
    // directly into PLACEABLES rather than via the `decorations` raw
    // registry, so they never hit the checkCategory call below — check them
    // here instead. An unrecognized category here is invisible in every
    // palette (see file header).
    if (p.kind === 'decoration' && p.light != null) {
      checkCategory(id, p, DECORATION_CATEGORIES, 'decoration');
    }
    checkStation(id, p);
  }

  // ── Utility ports table integrity ─────────────────────────────────
  for (const [id, ports] of Object.entries(utilityPorts)) {
    if (!beamline[id] && !infrastructure[id] && !roomFurnishings[id] && !labFurnishings[id]) {
      problem(id, 'utilityPorts', `utility-ports-v2.js entry '${id}' references no component or facility furnishing`);
    }
    for (const [portName, spec] of Object.entries(ports || {})) {
      if (!UTILITIES.has(spec.utility)) {
        problem(id, `utilityPorts.${portName}`, `unknown utility '${spec.utility}'`);
      }
      if (!PORT_ROLES.has(spec.role)) {
        problem(id, `utilityPorts.${portName}`, `invalid role '${spec.role}' (known: ${[...PORT_ROLES].join(', ')})`);
      }
      if (!PORT_SIDES.has(spec.side)) {
        problem(id, `utilityPorts.${portName}`, `invalid side '${spec.side}'`);
      }
      if (spec.offsetAlong != null && (typeof spec.offsetAlong !== 'number' || spec.offsetAlong < 0 || spec.offsetAlong > 1)) {
        problem(id, `utilityPorts.${portName}`, `offsetAlong must be a number in [0, 1], got ${JSON.stringify(spec.offsetAlong)}`);
      }
    }
  }

  // ── Optional: ROLE_BUILDERS coverage (info, never a problem) ──────
  if (roleBuilders) {
    const fallback = roleBuilderFallbacks(beamline, roleBuilders);
    if (fallback.length > 0) {
      console.info(
        `[content] ${fallback.length} beamline component(s) using fallback box/cylinder geometry ` +
        `(no ROLE_BUILDERS/DETAIL_BUILDERS entry): ${fallback.join(', ')}`,
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Research integrity.
//
// RESEARCH nodes advertise a payload two ways, and both were silently
// unchecked: `unlocks` ids that don't exist in COMPONENTS render as an empty
// "Unlocks:" badge and never print the "Unlocked: X" log line, and `effect`
// keys nothing reads (getEffect returns any key you ask for) promise a bonus
// the player never receives. 27 of 68 nodes — $403M of content — were dead
// this way. Pure, like validateContent: returns problems, throws nothing.
//
// The gating half of the contract IS enforced here (Phase 12): a node that
// advertises an unlock must actually gate it, and a gate must be reachable.
// Nine components used to be buildable from tick 0 while a node claimed to
// grant them — five with an explicit `unlocked: true` contradicting the node.
// The two rules:
//   - forward: for every id in `unlocks`, the component must not ship
//     `unlocked: true`, and its `requires` must name this node or one of this
//     node's prerequisites (a prerequisite gate is stricter, so the unlock is
//     still true when this node completes).
//   - reachability: a component's `requires` must name real, startable nodes.
//     A gate behind a hidden node (canStartResearch refuses those) or behind a
//     node that does not exist is hardware no playthrough can ever build —
//     worse than leaving it free.
// ---------------------------------------------------------------------------

// Transitive `requires` closure of a research node. Cycle-safe.
function researchPrerequisites(research, nodeId) {
  const seen = new Set();
  const req = r => (Array.isArray(r) ? r : (r != null ? [r] : []));
  const stack = [...req(research[nodeId]?.requires)];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...req(research[id]?.requires));
  }
  return seen;
}

export function validateResearch({ research = {}, components = {}, effectKeys = [] } = {}) {
  const problems = [];
  const known = new Set(effectKeys);
  const requiresOf = comp =>
    (Array.isArray(comp.requires) ? comp.requires : (comp.requires != null ? [comp.requires] : []));

  for (const [id, node] of Object.entries(research)) {
    if (!node) continue;
    for (const u of node.unlocks || []) {
      const comp = components[u];
      if (!comp) {
        problems.push({ id, field: 'unlocks', message: `unknown component id '${u}'` });
        continue;
      }
      const requires = requiresOf(comp);
      const prereqs = researchPrerequisites(research, id);
      if (comp.unlocked === true) {
        problems.push({
          id, field: 'unlocks',
          message: `claims to unlock '${u}' but it ships 'unlocked: true' — buildable from tick 0`,
        });
      } else if (requires.length === 0) {
        problems.push({
          id, field: 'unlocks',
          message: `claims to unlock '${u}' but it declares no 'requires' — buildable from tick 0`,
        });
      } else if (!requires.some(r => r === id || prereqs.has(r))) {
        problems.push({
          id, field: 'unlocks',
          message: `claims to unlock '${u}' but it is gated by '${requires.join(', ')}' — ` +
            `neither this node nor one of its prerequisites`,
        });
      }
    }
    for (const key of Object.keys(node.effect || {})) {
      if (!known.has(key)) {
        problems.push({
          id, field: 'effect',
          message: `'${key}' is read by nothing (known: ${effectKeys.join(', ')})`,
        });
      }
    }
    if (node.hidden) continue;
    const hasUnlock = (node.unlocks || []).some(u => !!components[u]);
    const hasEffect = Object.keys(node.effect || {}).some(k => known.has(k));
    if (!hasUnlock && !hasEffect) {
      problems.push({
        id, field: 'payload',
        message: 'node has no observable payload (no real unlocks, no consumed effect)',
      });
    }
  }

  // Reachability: a gate is only a gate if some playthrough can open it.
  // Skipped when `research` is empty (callers that validate components alone).
  if (Object.keys(research).length > 0) {
    for (const [compId, comp] of Object.entries(components)) {
      if (!comp) continue;
      for (const nodeId of requiresOf(comp)) {
        const node = research[nodeId];
        if (!node) {
          problems.push({
            id: compId, field: 'requires',
            message: `gated by unknown research node '${nodeId}' — unbuildable`,
          });
          continue;
        }
        const chain = [nodeId, ...researchPrerequisites(research, nodeId)];
        const blocked = chain.filter(n => research[n]?.hidden);
        if (blocked.length > 0) {
          problems.push({
            id: compId, field: 'requires',
            message: `gated behind hidden node(s) '${blocked.join(', ')}' which can never be ` +
              `started — unbuildable in any playthrough`,
          });
        }
      }
    }
  }

  return problems;
}
