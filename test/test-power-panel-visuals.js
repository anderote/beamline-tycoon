import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  DISTRIBUTION_FRONT_TERMINAL_LAYOUTS,
  DISTRIBUTION_HV_FRONT_TERMINAL_LAYOUTS,
  DISTRIBUTION_OUTPUT_LAYOUTS,
  DISTRIBUTION_POWER_FRONT_TERMINAL_LAYOUTS,
  DISTRIBUTION_TOP_INPUT_LAYOUTS,
} from '../src/data/distribution-output-layout.js';
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import {
  portAnchorOverride,
  POWER_HV_INPUT_MOUNTS,
} from '../src/data/utility-port-anchors.js';

globalThis.THREE = THREE;

const {
  _buildCompactHvDistributorRoles,
  _buildHVTransformerRoles,
  _buildPadMountTransformerRoles,
  _buildMCCRoles,
  _buildUPSRoles,
  _buildCompactDistributionPanelRoles,
  _buildSectionDistributionPanelRoles,
  _buildMainDistributionPanelRoles,
  _buildSpiderBoxRoles,
} = await import('../src/renderer3d/builders/power-builder.js');

function totalParts(buckets) {
  return Object.values(buckets).reduce((sum, parts) => sum + parts.length, 0);
}

function disposeBuckets(buckets) {
  for (const parts of Object.values(buckets)) {
    for (const geometry of parts) geometry.dispose();
  }
}

test('electrical distribution breaker controls use their authored front grids', () => {
  const expectedRows = {
    poleMountTransformer: [4],
    compactHvDistributor: [1, 1],
    powerPanel: [2, 2],
    sectionDistributionPanel: [4, 2, 1],
    mainDistributionPanel: [4, 4, 4, 2],
    mcc: [4, 4],
    ups: [2],
  };

  for (const [type, rowCounts] of Object.entries(expectedRows)) {
    const positions = DISTRIBUTION_OUTPUT_LAYOUTS[type];
    const rows = [...new Set(positions.map(({ y }) => y))];
    assert.deepEqual(rows.map(y => positions.filter(pos => pos.y === y).length), rowCounts,
      `${type} uses the expected horizontal output rows`);

    for (const y of rows) {
      const xs = positions.filter(pos => pos.y === y).map(({ x }) => x);
      assert.deepEqual(xs, [...xs].sort((a, b) => a - b),
        `${type} outputs run left-to-right within each row`);
    }
  }

  assert.ok(DISTRIBUTION_OUTPUT_LAYOUTS.compactHvDistributor.every(({ x }) => x === 0),
    'compact HV outputs form one centered vertical stack');

  const compactPowerColumns = [...new Set(
    DISTRIBUTION_OUTPUT_LAYOUTS.powerPanel.map(({ x }) => x),
  )];
  assert.equal(compactPowerColumns.length, 2, 'compact power outputs use two columns');
  for (const x of compactPowerColumns) {
    assert.equal(DISTRIBUTION_OUTPUT_LAYOUTS.powerPanel.filter(pos => pos.x === x).length, 2,
      'each compact power column contains two outputs');
  }
});

test('distribution inputs meet explicit inlet hardware while outputs use front glands', () => {
  const builders = {
    compactHvDistributor: _buildCompactHvDistributorRoles,
    powerPanel: _buildCompactDistributionPanelRoles,
    sectionDistributionPanel: _buildSectionDistributionPanelRoles,
    mainDistributionPanel: _buildMainDistributionPanelRoles,
    mcc: _buildMCCRoles,
    ups: _buildUPSRoles,
  };

  const authoredDistributionTypes = Object.keys(INFRASTRUCTURE_RAW).filter(type =>
    Object.values(getUtilityPortsV2(type)).some(port =>
      port.connectionKind === 'hvDistributionIn'
        || (port.connectionKind === 'hvDistributionTap' && port.role === 'sink')));
  assert.deepEqual(
    Object.keys(DISTRIBUTION_TOP_INPUT_LAYOUTS).sort(),
    authoredDistributionTypes.sort(),
    'every HV distribution device has a top-input layout',
  );
  assert.deepEqual(
    Object.keys(DISTRIBUTION_FRONT_TERMINAL_LAYOUTS).sort(),
    authoredDistributionTypes.sort(),
    'every HV distribution device has a front-output layout',
  );

  for (const [type, inputLayout] of Object.entries(DISTRIBUTION_TOP_INPUT_LAYOUTS)) {
    const ports = getUtilityPortsV2(type);
    const outputs = Object.entries(ports)
      .filter(([, port]) => port.connectionKind === 'hvDistributionOut'
        || port.connectionKind === 'powerDistributionOut')
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const outputLayout = DISTRIBUTION_FRONT_TERMINAL_LAYOUTS[type];
    assert.equal(outputLayout.length, outputs.length, `${type} lays out every physical output`);

    const inputAnchor = portAnchorOverride(type, 'hv_in');
    const expectedInputNormal = type === 'poleMountTransformer'
      ? { x: 0, y: 0, z: -1 }
      : { x: 0, y: 1, z: 0 };
    assert.deepEqual(inputAnchor.normal, expectedInputNormal,
      `${type}.hv_in faces its physical supply connection`);
    assert.equal(inputAnchor.localX, inputLayout.input.x, `${type}.hv_in uses its cap X`);
    assert.equal(inputAnchor.localZ, inputLayout.input.z, `${type}.hv_in uses its cap Z`);
    assert.equal(inputAnchor.y, inputLayout.input.y, `${type}.hv_in lands on the cap top`);

    for (const [portName] of outputs) {
      const match = portName.match(/_(\d+)$/);
      const index = Number(match?.[1]) - 1;
      const terminal = portName.startsWith('hv_out_')
        ? DISTRIBUTION_HV_FRONT_TERMINAL_LAYOUTS[type]?.[index]
        : DISTRIBUTION_POWER_FRONT_TERMINAL_LAYOUTS[type]?.[index];
      const anchor = portAnchorOverride(type, portName);
      assert.deepEqual(anchor.normal, { x: 0, y: 0, z: 1 },
        `${type}.${portName} faces forward`);
      assert.equal(anchor.localX, terminal.x, `${type}.${portName} uses its gland X`);
      assert.equal(anchor.localZ, terminal.z, `${type}.${portName} uses its gland Z`);
      assert.equal(anchor.y, terminal.y, `${type}.${portName} uses its breaker-row height`);
    }

    const build = builders[type];
    if (!build) {
      // Pole-mounted gear uses its authored parts model rather than a role
      // builder. Its tagged cap parts still share both terminal contracts.
      const inputCap = INFRASTRUCTURE_RAW[type].parts
        .find(part => part.utilityTerminalCap === true);
      const inputCapY = type === 'poleMountTransformer'
        ? (inputCap.y + inputCap.h / 2) * 0.5
        : (inputCap.y + inputCap.h) * 0.5;
      assert.ok(inputCap
        && Math.abs(inputCap.x * 0.5 - inputLayout.input.x) < 1e-6
        && Math.abs(inputCapY - inputLayout.input.y) < 1e-6
        && Math.abs(inputCap.z * 0.5 - inputLayout.input.z) < 1e-6,
      `${type} authors one visible input cap`);

      const outputCaps = INFRASTRUCTURE_RAW[type].parts
        .filter(part => part.utilityOutputTerminalCap === true);
      assert.equal(outputCaps.length, outputLayout.length,
        `${type} authors one front cap per output anchor`);
      for (const terminal of outputLayout) {
        assert.ok(outputCaps.some(part =>
          Math.abs(part.x * 0.5 - terminal.x) < 1e-6
          && Math.abs(part.y * 0.5 - terminal.y) < 1e-6
          && Math.abs((part.z + part.l / 2) * 0.5 - terminal.z) < 1e-6),
        `${type} has visible cap geometry at (${terminal.x}, ${terminal.y}, ${terminal.z})`);
      }
      continue;
    }
    const buckets = build();
    const inputCap = buckets.copper.find(geometry => {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      return Math.abs(center.x - inputLayout.input.x) < 1e-6
        && Math.abs(center.z - inputLayout.input.z) < 1e-6
        && Math.abs(geometry.boundingBox.max.y - inputLayout.input.y) < 1e-6;
    });
    assert.ok(inputCap, `${type} renders a metal cap at its top input anchor`);

    for (const terminal of outputLayout) {
      const cap = buckets.copper.find(geometry => {
        geometry.computeBoundingBox();
        const center = geometry.boundingBox.getCenter(new THREE.Vector3());
        return Math.abs(center.x - terminal.x) < 1e-6
          && Math.abs(center.y - terminal.y) < 1e-6
          && Math.abs(geometry.boundingBox.max.z - terminal.z) < 1e-6;
      });
      assert.ok(cap,
        `${type} renders a front metal gland at (${terminal.x}, ${terminal.y}, ${terminal.z})`);
    }
    disposeBuckets(buckets);
  }
});

test('transformer HV inputs terminate on visible roof-bushing caps', () => {
  const builders = {
    padMountTransformer: _buildPadMountTransformerRoles,
    hvTransformer: _buildHVTransformerRoles,
    facilityTransformer: () => _buildHVTransformerRoles(false),
    gridIntertieTransformer: () => _buildHVTransformerRoles(false),
  };

  for (const [type, build] of Object.entries(builders)) {
    const mount = POWER_HV_INPUT_MOUNTS[type];
    const anchor = portAnchorOverride(type, 'hv_in');
    assert.equal(anchor.y, mount.y, `${type}.hv_in uses its standardized height`);
    assert.equal(anchor.localX, mount.localX, `${type}.hv_in uses its standardized X`);
    assert.equal(anchor.localZ, mount.localZ, `${type}.hv_in uses its standardized Z`);
    assert.deepEqual(anchor.normal, mount.normal,
      `${type}.hv_in uses its standardized normal`);
    assert.deepEqual(mount.normal, { x: 0, y: 1, z: 0 },
      `${type}.hv_in faces upward`);

    const buckets = build();
    const cap = buckets.copper.find(geometry => {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      return Math.abs(center.x - mount.localX) < 1e-6
        && Math.abs(center.z - mount.localZ) < 1e-6
        && Math.abs(geometry.boundingBox.max.y - mount.y) < 1e-6;
    });
    assert.ok(cap, `${type}.hv_in lands on a visible metal cap`);
    assert.ok(buckets.accent.length > 0, `${type}.hv_in has visible ceramic insulation`);
    disposeBuckets(buckets);
  }
});

test('HV transformer feeder rack supports all four existing cable anchors', () => {
  const transformer = _buildHVTransformerRoles();
  const terminalCaps = transformer.copper.filter(geometry => {
    geometry.computeBoundingBox();
    return Math.abs(geometry.boundingBox.max.y - 1.45) < 1e-6;
  });

  assert.equal(transformer.accent.length, 19,
    'four feeder terminals each add a ceramic post and three skirts');
  assert.equal(terminalCaps.length, 4, 'the rack exposes four metal terminal caps');
  assert.ok(transformer.iron.length >= 4, 'a crossarm and two brackets support the terminal row');

  const centers = terminalCaps.map(geometry => {
    return geometry.boundingBox.getCenter(new THREE.Vector3());
  });
  assert.deepEqual(centers.map(({ x }) => Number(x.toFixed(2))), [-0.75, -0.25, 0.25, 0.75]);
  assert.ok(centers.every(({ z }) => Math.abs(z - 0.82) < 1e-6),
    'terminal caps stay on the existing front cable plane');
  for (const geometry of terminalCaps) {
    assert.ok(Math.abs(geometry.boundingBox.max.y - 1.45) < 1e-6,
      'each cable lands on the top of its visible terminal cap');
  }

  const sharedTank = _buildHVTransformerRoles(false);
  assert.equal(sharedTank.accent.length, 3,
    'two- and six-outlet transformer tiers do not inherit the four-terminal rack');

  disposeBuckets(transformer);
  disposeBuckets(sharedTank);
});

test('distribution panel rungs are detailed NEMA enclosures, not plain boxes', () => {
  const compact = _buildCompactDistributionPanelRoles();
  const section = _buildSectionDistributionPanelRoles();
  const main = _buildMainDistributionPanelRoles();

  assert.ok(totalParts(compact) >= 35,
    `compact panel has doors, hinges, breakers, labels and vents (${totalParts(compact)} parts)`);
  assert.ok(totalParts(section) > totalParts(compact),
    'section panel visibly adds a second cabinet/breaker bank');
  assert.ok(totalParts(main) > totalParts(section),
    'main panel visibly adds its twelve green and two HV output lineup');

  for (const [name, buckets] of [['compact', compact], ['section', section], ['main', main]]) {
    assert.ok(buckets.accent.length >= 3, `${name} panel has a cabinet, cap and proud door`);
    assert.ok(buckets.detail.length >= 15, `${name} panel has gasket frames and side louvers`);
    assert.equal(buckets.glow.length, 3, `${name} panel has a restrained three-lamp status row`);
    assert.ok(buckets.copper.length >= 1, `${name} panel exposes its grounding bond`);
    disposeBuckets(buckets);
  }
});

test('compact HV distribution and MCC show serviceable electrical compartments', () => {
  const compactHv = _buildCompactHvDistributorRoles();
  const mcc = _buildMCCRoles();

  assert.ok(totalParts(compactHv) >= 20,
    `compact HV distributor has a door, two breaker controls and physical terminals (${totalParts(compactHv)} parts)`);
  assert.equal(compactHv.glow.length, 1, 'compact HV distributor has one restrained status lamp');
  assert.equal(compactHv.copper.length, 4,
    'compact HV distributor shows one inlet, two outlets and its grounding bond');
  assert.ok(totalParts(mcc) >= 70,
    `MCC has eight individually legible starter buckets (${totalParts(mcc)} parts)`);
  assert.equal(mcc.glow.length, 8, 'each MCC starter bucket has one pilot lamp');
  assert.ok(mcc.accent.length >= 9, 'MCC enclosure carries eight proud compartment doors');

  disposeBuckets(compactHv);
  disposeBuckets(mcc);
});

test('portable spider box gains a lid, guards, label and carry handle', () => {
  const spider = _buildSpiderBoxRoles();
  assert.ok(totalParts(spider) >= 17,
    `portable field box has believable case hardware (${totalParts(spider)} parts)`);
  assert.ok(spider.stand.length >= 3, 'carry handle has two uprights and a grip');
  assert.ok(spider.iron.length >= 4, 'rubberized corner guards protect the case');
  assert.ok(spider.pipe.length >= 1, 'lid carries a brushed equipment label');
  disposeBuckets(spider);
});
