/** Shared by kiosk placement and physical collision bounds. Front is local +Z. */
export const TERMINALS = {
  education: { pos: [-80, 0.22, -100], yaw: 0, label: 'CAMPUS', subtitle: 'EDUCATION / SKILLS', accent: '#f1b7db' },
  // Set back toward the shelter: the avenue lamp at x=-13.2 must not cross the screen from the arrival camera.
  'amd-intern': { pos: [-18, 0.22, -87], yaw: 0, label: 'DOWNTOWN', subtitle: 'WORK / EXPERIENCE', accent: '#7edce8' },
  projects: { pos: [52, 0.22, -228], yaw: 0, label: 'MARKET', subtitle: 'PROJECT DIRECTORY', accent: '#ffbb70' },
  // Off the pier's centre-line: parked at x 140 it stood directly between an arriving visitor and the
  // departures board at (140, 32.1) and hid its bottom row.
  contact: { pos: [136.3, 2.9, 8], yaw: Math.PI - 0.22, label: 'HARBOR', subtitle: 'CONTACT / RÉSUMÉ', accent: '#a9dbc3' },
} as const;
export type TerminalId = keyof typeof TERMINALS;
