/** Shared by kiosk placement and physical collision bounds. Front is local +Z. */
export const TERMINALS = {
  education: { pos: [-80, 0.22, -100], yaw: 0, label: 'CAMPUS', subtitle: 'EDUCATION / SKILLS', accent: '#f1b7db' },
  // Set back toward the shelter: the avenue lamp at x=-13.2 must not cross the screen from the arrival camera.
  'amd-intern': { pos: [-18, 0.22, -87], yaw: 0, label: 'DOWNTOWN', subtitle: 'WORK / EXPERIENCE', accent: '#7edce8' },
  projects: { pos: [26, 0.22, -220], yaw: -Math.PI / 2, label: 'MARKET', subtitle: 'PROJECT DIRECTORY', accent: '#ffbb70' },
  contact: { pos: [140, 2.9, 8], yaw: Math.PI, label: 'HARBOR', subtitle: 'CONTACT / RÉSUMÉ', accent: '#a9dbc3' },
} as const;
export type TerminalId = keyof typeof TERMINALS;
