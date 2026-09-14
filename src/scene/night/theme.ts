/**
 * Per-district look: palettes and point-light rigs read by the district modules, the sign
 * cutout lists, particles and audio, so one table drives the theming.
 */
import type { SectionId } from './journey';

export interface DistrictTheme {
  id: SectionId;
  name: string;      // nav label
  subtitle: string;  // résumé meaning
  primary: number;   // main neon
  secondary: number; // second neon
  warm: number;      // lamps / lanterns
  ground: number;    // plaza / deck tint
  signGlow: string;  // css colour for canvas neon
}

export const THEMES: Record<Exclude<SectionId, 'city'>, DistrictTheme> = {
  education: { id: 'education', name: 'Campus', subtitle: 'Education', primary: 0xff9ad5, secondary: 0x00e5ff, warm: 0xffb070, ground: 0x1b1a2a, signGlow: '#ff9ad5' },
  work: { id: 'work', name: 'Downtown', subtitle: 'Work', primary: 0xdfe8ff, secondary: 0x00e5ff, warm: 0x4a6aff, ground: 0x0e1018, signGlow: '#dfe8ff' },
  projects: { id: 'projects', name: 'Market', subtitle: 'Projects', primary: 0xff3a2a, secondary: 0x2ec4b6, warm: 0xff9a3d, ground: 0x1a1512, signGlow: '#ff9a3d' },
  contact: { id: 'contact', name: 'Harbor', subtitle: 'Contact', primary: 0x2ec4b6, secondary: 0xf2ff3d, warm: 0xffd8a0, ground: 0x14161c, signGlow: '#2ec4b6' },
};
