export type PenncrestSeatTemplateSeat = {
  row: string;
  number: number;
  sectionName: 'LEFT' | 'CENTER' | 'RIGHT';
  x: number;
  y: number;
  isAccessible: boolean;
};

const FULL_CENTER_BLOCK = Array.from({ length: 14 }, (_, index) => 114 - index);
const FRONT_ROW_CENTER_BLOCK = [113, 112, 111, 110, 109, 108, 106, 105, 104, 103, 102, 101];
const BACK_ROW_CENTER_BLOCK = [113, 111, 109, 106, 104, 102];
const SEAT_GRID_STEP = 40;
const ROW_VERTICAL_START = 100;

type RowLayout = {
  row: string;
  leftMaxOdd: number;
  centerSeats: number[];
  rightMaxEven: number;
};

const PENNCREST_ROW_LAYOUTS: RowLayout[] = [
  { row: 'A', leftMaxOdd: 7, centerSeats: FRONT_ROW_CENTER_BLOCK, rightMaxEven: 8 },
  { row: 'B', leftMaxOdd: 11, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 12 },
  { row: 'C', leftMaxOdd: 11, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 12 },
  { row: 'D', leftMaxOdd: 11, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 12 },
  { row: 'E', leftMaxOdd: 13, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 14 },
  { row: 'F', leftMaxOdd: 13, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 14 },
  { row: 'G', leftMaxOdd: 15, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 16 },
  { row: 'H', leftMaxOdd: 15, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 16 },
  { row: 'J', leftMaxOdd: 15, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 16 },
  { row: 'K', leftMaxOdd: 17, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 18 },
  { row: 'L', leftMaxOdd: 17, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 18 },
  { row: 'M', leftMaxOdd: 19, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 20 },
  { row: 'N', leftMaxOdd: 19, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 20 },
  { row: 'O', leftMaxOdd: 21, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 22 },
  { row: 'P', leftMaxOdd: 21, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 22 },
  { row: 'Q', leftMaxOdd: 21, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 22 },
  { row: 'R', leftMaxOdd: 23, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 24 },
  { row: 'S', leftMaxOdd: 23, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 24 },
  { row: 'T', leftMaxOdd: 25, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 26 },
  { row: 'U', leftMaxOdd: 25, centerSeats: BACK_ROW_CENTER_BLOCK, rightMaxEven: 26 },
  { row: 'V', leftMaxOdd: 25, centerSeats: [], rightMaxEven: 26 },
  { row: 'W', leftMaxOdd: 27, centerSeats: [], rightMaxEven: 28 }
];

const ACCESSIBLE_SEATS_BY_ROW: Record<string, number[]> = {
  // Blue seats from "Penncrest Seating Chart (1).xlsx"
  A: [5, 6, 7, 8, 101, 102, 112, 113],
  U: [102, 104, 106, 109, 111, 113]
};

const leftColumnForSeat = (seatNumber: number) => 16 - (seatNumber + 1) / 2;
const centerColumnForSeat = (seatNumber: number) => 133 - seatNumber;
const rightColumnForSeat = (seatNumber: number) => 35 + seatNumber / 2;

const PENNCREST_SEAT_TEMPLATE: PenncrestSeatTemplateSeat[] = (() => {
  const seats: PenncrestSeatTemplateSeat[] = [];

  PENNCREST_ROW_LAYOUTS.forEach((layout, rowIndex) => {
    const y = rowIndex * SEAT_GRID_STEP + ROW_VERTICAL_START;
    const accessibleSeatNumbers = new Set(ACCESSIBLE_SEATS_BY_ROW[layout.row] ?? []);

    for (let seatNumber = 1; seatNumber <= layout.leftMaxOdd; seatNumber += 2) {
      seats.push({
        row: layout.row,
        number: seatNumber,
        sectionName: 'LEFT',
        x: leftColumnForSeat(seatNumber) * SEAT_GRID_STEP,
        y,
        isAccessible: accessibleSeatNumbers.has(seatNumber)
      });
    }

    layout.centerSeats.forEach((seatNumber) => {
      seats.push({
        row: layout.row,
        number: seatNumber,
        sectionName: 'CENTER',
        x: centerColumnForSeat(seatNumber) * SEAT_GRID_STEP,
        y,
        isAccessible: accessibleSeatNumbers.has(seatNumber)
      });
    });

    for (let seatNumber = 2; seatNumber <= layout.rightMaxEven; seatNumber += 2) {
      seats.push({
        row: layout.row,
        number: seatNumber,
        sectionName: 'RIGHT',
        x: rightColumnForSeat(seatNumber) * SEAT_GRID_STEP,
        y,
        isAccessible: accessibleSeatNumbers.has(seatNumber)
      });
    }
  });

  return seats;
})();

export function getPenncrestSeatTemplate(): PenncrestSeatTemplateSeat[] {
  return PENNCREST_SEAT_TEMPLATE.map((seat) => ({ ...seat }));
}
