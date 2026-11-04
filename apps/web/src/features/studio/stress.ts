/** Dev-only: generate a large model (~400 walls / 150 rooms) to check canvas performance. */
import type { BuildingModel } from "@hvac/shared-types";
import { addRoomWithWalls, makeOpening } from "./model-ops";

export function addStressGrid(draft: BuildingModel, floorId: string, opts = { cols: 15, rows: 10, w: 144, h: 120, origin: { x: 0, y: 0 } }) {
  const types = ["bedroom", "bathroom", "kitchen", "living", "office", "closet", "hallway"] as const;
  let n = 0;
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      const x = opts.origin.x + c * opts.w, y = opts.origin.y + r * opts.h;
      const ids = addRoomWithWalls(draft, floorId, [
        { x, y },
        { x: x + opts.w, y },
        { x: x + opts.w, y: y + opts.h },
        { x, y: y + opts.h },
      ], { name: `Stress ${r + 1}-${c + 1}` });
      const room = draft.rooms.find((x) => x.id === ids[0])!;
      room.roomType = types[n++ % types.length]!;
      const wallId = ids[1];
      if (wallId) draft.openings.push(makeOpening(n % 3 === 0 ? "door" : "window", wallId, opts.w / 2));
    }
  }
}
