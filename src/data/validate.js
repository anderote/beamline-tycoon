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

const PORT_SIDES = new Set(['front', 'back', 'left', 'right']);
const PORT_ROLES = new Set(['source', 'sink', 'pass']);
const BEAMLINE_ROLES = new Set(['junction', 'placement']);
const PLACEMENTS = new Set(['module', 'attachment']);

const BEAMLINE_CATEGORIES = new Set(Object.keys(MODES.beamline.categories));
const INFRA_CATEGORIES = new Set(Object.keys(MODES.infra.categories));
const DECORATION_CATEGORIES = new Set(
  Object.entries(MODES.grounds.categories)
    .filter(([, c]) => c.isDecorationTab)
    .map(([key]) => key),
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

  function checkBeamPorts(id, def) {
    if (def.ports == null) return;
    for (const [portName, spec] of Object.entries(def.ports)) {
      if (!spec || !PORT_SIDES.has(spec.side)) {
        problem(id, `ports.${portName}`, `invalid side '${spec?.side}' (known: ${[...PORT_SIDES].join(', ')})`);
      }
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
  }

  // ── Utility ports table integrity ─────────────────────────────────
  for (const [id, ports] of Object.entries(utilityPorts)) {
    if (!beamline[id] && !infrastructure[id]) {
      problem(id, 'utilityPorts', `utility-ports-v2.js entry '${id}' references no beamline/infrastructure component`);
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
