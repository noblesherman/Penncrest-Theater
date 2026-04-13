export const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
export const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
export const MAX_TEACHER_COMP_TICKETS = 2;
export const MAX_STUDENT_COMP_TICKETS = 2;

export const naturalSort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export const parseSeatIds = (input: string) =>
  [...new Set(input.split(',').map((value) => value.trim()).filter((value): value is string => Boolean(value)))];

export const buildGeneralAdmissionLineIds = (quantity: number) =>
  Array.from({ length: Math.max(0, Math.min(quantity, 50)) }, (_value, index) => `ga-${index + 1}`);

export const isTeacherTicketName = (name: string) => {
  const normalized = name.trim().toLowerCase();
  return normalized.includes('teacher') || (normalized.includes('rtmsd') && normalized.includes('staff'));
};

export const isStudentInShowTicketName = (name: string) =>
  name.trim().toLowerCase().includes('student in show');

export function pickComplimentarySeatIds(
  seats: Array<{ id: string; sectionName: string; row: string; number: number; basePriceCents: number }>,
  quantity: number
): Set<string> {
  if (quantity <= 0) return new Set();
  const ranked = [...seats].sort((a, b) => {
    if (a.basePriceCents !== b.basePriceCents) return b.basePriceCents - a.basePriceCents;
    if (a.sectionName !== b.sectionName) return naturalSort(a.sectionName, b.sectionName);
    if (a.row !== b.row) return naturalSort(a.row, b.row);
    return a.number - b.number;
  });
  return new Set(ranked.slice(0, quantity).map((seat) => seat.id));
}
