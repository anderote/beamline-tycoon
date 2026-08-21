// src/data/placeables/furnishings.js
//
// Furnishings = social/office decor placed in room facility zones
// (control room, office, meeting room, cafeteria). Sourced from
// facility-room-furnishings.raw.js. Lab/shop equipment lives in
// equipment.js instead.

import { FACILITY_ROOM_FURNISHINGS_RAW } from '../facility-room-furnishings.raw.js';
import { toDims } from './dims.js';

// Legacy room furniture predates the palette groups. Keep the migration map
// here so old authored entries remain organized while new entries can declare
// `furnitureGroup` directly in the raw catalogue.
const LEGACY_FURNITURE_GROUPS = {
  seating: ['couch', 'waitingBench', 'officeChair', 'ergonomicChair', 'executiveChair', 'operatorChair', 'meetingChair', 'barStool', 'cafeteriaChair'],
  tables: ['desk', 'sharedDesk', 'privateOfficeDesk', 'receptionDesk', 'coffeeTable', 'loungeTable', 'collaborationTable', 'diningTable', 'cafeTable', 'conferenceTable', 'packingTable', 'breakfastBar', 'servingCounter'],
  storage: ['filingCabinet', 'bookshelf', 'utilityShelving', 'palletRack', 'partsBinRack', 'lockerBank', 'cafeteriaRefrigerator'],
  hospitality: ['coffeeMachine', 'vendingMachine', 'microwave', 'waterCooler', 'sinkCounter', 'condimentStation', 'wasteStation'],
  decor: ['whiteboard', 'pottedPlant', 'floorPlant', 'faxMachine', 'printer', 'acousticPod', 'beamlineDisplayCase', 'areaRug', 'runnerRug', 'visitorKiosk', 'brochureRack', 'coatRack', 'supplyCart', 'projector', 'phoneUnit', 'whiteboardLarge', 'monitorBank', 'serverRack', 'dataAppliance', 'dataStorageRack', 'cpuComputeRack', 'gpuComputeRack', 'operatorConsole', 'alarmPanel'],
};
const LEGACY_GROUP_BY_ID = Object.fromEntries(
  Object.entries(LEGACY_FURNITURE_GROUPS).flatMap(([group, ids]) => ids.map(id => [id, group])),
);

export const FURNISHING_DEFS = Object.values(FACILITY_ROOM_FURNISHINGS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw);
  const stackable = raw.stackable ?? false;
  return {
    ...raw,
    furnitureGroup: raw.furnitureGroup ?? LEGACY_GROUP_BY_ID[raw.id] ?? 'other',
    kind: 'furnishing',
    subW,
    subL,
    subH,
    hasSurface: raw.hasSurface ?? true,
    stackable,
    portable: raw.portable ?? stackable,
  };
});
