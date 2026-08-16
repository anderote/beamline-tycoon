// Required utility-port presentation shared by every build-menu preview.
// Requirements come from the merged public port contract, not the older
// requiredConnections mirror, so the preview cannot omit a real sink such as
// a beamline component's vacuum port or a distribution panel's HV input.

import { UTILITY_TYPES } from '../utility/registry.js';

/**
 * Return one display entry per required utility type, preserving the authored
 * sink-port order. Multiple sinks of one type collapse into an explicit count.
 */
export function requiredUtilityPorts(comp) {
  const byUtility = new Map();
  for (const [portName, port] of Object.entries(comp?.ports || {})) {
    if (!port || port.role !== 'sink' || !port.utility) continue;
    const descriptor = UTILITY_TYPES[port.utility];
    if (!descriptor) continue;
    const entry = byUtility.get(port.utility) || {
      utilityType: port.utility,
      label: descriptor.displayName || port.utility,
      color: descriptor.markerColor || descriptor.color || '#cccccc',
      count: 0,
      portNames: [],
    };
    entry.count++;
    entry.portNames.push(portName);
    byUtility.set(port.utility, entry);
  }
  return [...byUtility.values()];
}

/** Append the common colored "Required ports" block to a preview container. */
export function appendRequiredPortRequirements(container, compOrPorts) {
  if (!container) return null;
  const ports = Array.isArray(compOrPorts)
    ? compOrPorts
    : requiredUtilityPorts(compOrPorts);
  if (!ports.length) return null;

  const block = document.createElement('div');
  block.className = 'required-port-requirements';

  const heading = document.createElement('div');
  heading.className = 'required-port-heading';
  heading.textContent = 'Required ports';

  const list = document.createElement('div');
  list.className = 'required-port-list';
  list.setAttribute('role', 'list');
  for (const port of ports) {
    const item = document.createElement('span');
    item.className = 'required-port-type';
    item.dataset.utilityType = port.utilityType;
    item.style.setProperty('--required-port-color', port.color);
    item.setAttribute('role', 'listitem');
    item.textContent = `${port.label}${port.count > 1 ? ` ×${port.count}` : ''}`;
    list.appendChild(item);
  }

  block.append(heading, list);
  container.appendChild(block);
  return block;
}
