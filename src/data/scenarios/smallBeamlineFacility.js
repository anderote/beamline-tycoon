export function generateSmallBeamlineFacility() {
  const floors = [];
  const zones = [];
  const walls = [];
  const doors = [];
  const placeables = [];
  let nextId = 1;
  const cornerHeights = new Map();
  const addFloor = (type, col, row) => floors.push({ type, col, row, variant: 0 });
  const addZone = (type, col, row) => zones.push({ type, col, row });
  const addWall = (col, row, edge, type) => walls.push({ col, row, edge, type });
  const addDoor = (col, row, edge, type) => doors.push({ col, row, edge, type });
  const addFurn = (type, col, row, dir = 0) => placeables.push({ id: `pl_${nextId++}`, type, col, row, subCol: 1, subRow: 1, dir, kind: 'furnishing' });

  const B0col = -8, B0row = -3, BW = 18, BH = 10;
  for (let c = B0col; c < B0col + BW; c++) for (let r = B0row; r < B0row + BH; r++) addFloor('concrete', c, r);

  const beamHall = { x0: B0col + 1, y0: B0row + 2, x1: B0col + BW - 2, y1: B0row + 4 };
  for (let c = beamHall.x0; c <= beamHall.x1; c++) for (let r = beamHall.y0; r <= beamHall.y1; r++) addFloor('concrete', c, r);

  const hallRow = B0row + 6;
  for (let c = B0col + 1; c < B0col + BW - 1; c++) addFloor('hallway', c, hallRow);

  const ctrlRect = { x0: B0col + 1, y0: hallRow + 1, x1: B0col + 6, y1: B0row + BH - 2 };
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addFloor('officeFloor', c, r);
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addZone('controlRoom', c, r);

  const cafeRect = { x0: B0col + 9, y0: hallRow + 1, x1: B0col + BW - 2, y1: B0row + BH - 2 };
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addFloor('officeFloor', c, r);
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addZone('cafeteria', c, r);

  const rfRect = { x0: B0col + 1, y0: B0row + 1, x1: B0col + 6, y1: beamHall.y0 - 1 };
  for (let c = rfRect.x0; c <= rfRect.x1; c++) for (let r = rfRect.y0; r <= rfRect.y1; r++) addFloor('labFloor', c, r);
  for (let c = rfRect.x0; c <= rfRect.x1; c++) for (let r = rfRect.y0; r <= rfRect.y1; r++) addZone('rfLab', c, r);

  const vacRect = { x0: B0col + 10, y0: B0row + 1, x1: B0col + 15, y1: beamHall.y0 - 1 };
  for (let c = vacRect.x0; c <= vacRect.x1; c++) for (let r = vacRect.y0; r <= vacRect.y1; r++) addFloor('labFloor', c, r);
  for (let c = vacRect.x0; c <= vacRect.x1; c++) for (let r = vacRect.y0; r <= vacRect.y1; r++) addZone('vacuumLab', c, r);

  for (let c = B0col; c < B0col + BW; c++) {
    addWall(c, B0row, 'n', 'structuralWall');
    addWall(c, B0row + BH - 1, 's', 'structuralWall');
  }
  for (let r = B0row; r < B0row + BH; r++) {
    addWall(B0col, r, 'w', 'structuralWall');
    addWall(B0col + BW - 1, r, 'e', 'structuralWall');
  }
  for (let c = beamHall.x0; c <= beamHall.x1; c++) {
    addWall(c, beamHall.y0, 'n', 'structuralWall');
    addWall(c, beamHall.y1, 's', 'structuralWall');
  }
  addWall(beamHall.x0, beamHall.y0, 'w', 'structuralWall');
  addWall(beamHall.x1, beamHall.y0, 'e', 'structuralWall');
  addWall(beamHall.x0, beamHall.y1, 'w', 'structuralWall');
  addWall(beamHall.x1, beamHall.y1, 'e', 'structuralWall');

  addDoor(B0col + 3, hallRow, 'n', 'labDoor');
  addDoor(B0col + 11, hallRow, 'n', 'labDoor');
  addDoor(B0col + 3, hallRow, 's', 'officeDoor');
  addDoor(B0col + 11, hallRow, 's', 'officeDoor');
  addDoor(beamHall.x0 + 3, beamHall.y1, 's', 'labDoor');
  addDoor(beamHall.x1 - 3, beamHall.y1, 's', 'labDoor');
  addDoor(B0col + BW - 1, hallRow, 'e', 'officeDoor');

  addFurn('operatorConsole', ctrlRect.x0 + 1, ctrlRect.y0 + 1, 1);
  addFurn('monitorBank', ctrlRect.x0 + 3, ctrlRect.y0, 0);
  addFurn('operatorChair', ctrlRect.x0 + 1, ctrlRect.y0 + 2, 0);
  addFurn('serverRack', ctrlRect.x1 - 1, ctrlRect.y0 + 1, 2);
  addFurn('diningTable', cafeRect.x0 + 1, cafeRect.y0 + 1, 0);
  addFurn('cafeteriaChair', cafeRect.x0, cafeRect.y0 + 1, 0);
  addFurn('cafeteriaChair', cafeRect.x0 + 2, cafeRect.y0 + 1, 0);
  addFurn('vendingMachine', cafeRect.x1, cafeRect.y0, 3);
  addFurn('labBench', rfRect.x0 + 1, rfRect.y0, 1);
  addFurn('labBench', vacRect.x0 + 1, vacRect.y0, 1);

  return { floors, zones, walls, doors, placeables, placeableNextId: nextId, cornerHeights, infraBlockers: [] };
}
