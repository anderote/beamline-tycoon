export function generateRealLab() {
  const floors = [];
  const zones = [];
  const walls = [];
  const doors = [];
  const placeables = [];
  let nextId = 1;
  const cornerHeights = new Map(); // flat: all z=0, no cliffs
  const addFloor = (type, col, row, variant = 0) => floors.push({ type, col, row, variant });
  const addZone = (type, col, row) => zones.push({ type, col, row });
  const addWall = (col, row, edge, type) => walls.push({ col, row, edge, type });
  const addDoor = (col, row, edge, type = 'officeDoor') => doors.push({ col, row, edge, type });
  const addFurn = (type, col, row, subCol = 1, subRow = 1, dir = 0) => {
    placeables.push({ id: `fn_${nextId++}`, type, col, row, subCol, subRow, dir, kind: 'furnishing' });
  };
  const originCol = -6, originRow = -2;
  const W = 14, H = 10;
  for (let c = originCol; c < originCol + W; c++) {
    for (let r = originRow; r < originRow + H; r++) {
      addFloor('concrete', c, r);
    }
  }
  const hallRow = originRow + 4;
  for (let c = originCol; c < originCol + W; c++) {
    addFloor('hallway', c, hallRow);
  }
  const rfLabRect = { x0: originCol + 1, y0: originRow + 1, x1: originCol + 5, y1: hallRow - 1 };
  for (let c = rfLabRect.x0; c <= rfLabRect.x1; c++) {
    for (let r = rfLabRect.y0; r <= rfLabRect.y1; r++) addFloor('labFloor', c, r);
  }
  for (let c = rfLabRect.x0; c <= rfLabRect.x1; c++) {
    for (let r = rfLabRect.y0; r <= rfLabRect.y1; r++) addZone('rfLab', c, r);
  }
  const vacuumRect = { x0: originCol + 7, y0: originRow + 1, x1: originCol + 11, y1: hallRow - 1 };
  for (let c = vacuumRect.x0; c <= vacuumRect.x1; c++) {
    for (let r = vacuumRect.y0; r <= vacuumRect.y1; r++) addFloor('labFloor', c, r);
  }
  for (let c = vacuumRect.x0; c <= vacuumRect.x1; c++) {
    for (let r = vacuumRect.y0; r <= vacuumRect.y1; r++) addZone('vacuumLab', c, r);
  }
  const ctrlRect = { x0: originCol + 1, y0: hallRow + 2, x1: originCol + 5, y1: originRow + H - 1 };
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) {
    for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addFloor('officeFloor', c, r);
  }
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) {
    for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addZone('controlRoom', c, r);
  }
  const cafeRect = { x0: originCol + 7, y0: hallRow + 2, x1: originCol + 11, y1: originRow + H - 1 };
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) {
    for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addFloor('officeFloor', c, r);
  }
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) {
    for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addZone('cafeteria', c, r);
  }
  for (let c = originCol; c < originCol + W; c++) {
    addWall(c, originRow, 'n', 'officeWall');
    addWall(c, originRow + H - 1, 's', 'officeWall');
  }
  for (let r = originRow; r < originRow + H; r++) {
    addWall(originCol, r, 'w', 'officeWall');
    addWall(originCol + W - 1, r, 'e', 'officeWall');
  }
  addDoor(originCol + 3, hallRow, 's', 'officeDoor');
  addDoor(originCol + 9, hallRow, 's', 'officeDoor');
  addDoor(originCol + 3, hallRow, 'n', 'labDoor');
  addDoor(originCol + 9, hallRow, 'n', 'labDoor');
  addDoor(originCol + W - 1, hallRow, 'e', 'officeDoor');
  addFurn('operatorConsole', ctrlRect.x0 + 1, ctrlRect.y0 + 1, 1, 1, 1);
  addFurn('monitorBank', ctrlRect.x0 + 2, ctrlRect.y0 + 1, 0, 0, 0);
  addFurn('operatorChair', ctrlRect.x0 + 1, ctrlRect.y0 + 2, 0, 0, 0);
  addFurn('serverRack', ctrlRect.x1, ctrlRect.y0 + 1, 0, 0, 2);
  addFurn('diningTable', cafeRect.x0 + 1, cafeRect.y0 + 1, 1, 1, 0);
  addFurn('cafeteriaChair', cafeRect.x0, cafeRect.y0 + 1, 0, 0, 0);
  addFurn('cafeteriaChair', cafeRect.x0 + 2, cafeRect.y0 + 1, 0, 0, 0);
  addFurn('vendingMachine', cafeRect.x1, cafeRect.y0 + 1, 0, 0, 3);
  addFurn('labBench', rfLabRect.x0 + 1, rfLabRect.y0 + 1, 1, 0, 1);
  addFurn('labBench', vacuumRect.x0 + 1, vacuumRect.y0 + 1, 1, 0, 1);
  return { floors, zones, walls, doors, placeables, placeableNextId: nextId, cornerHeights, infraBlockers: [] };
}
