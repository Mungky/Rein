import type { IconName } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  badge?: number;
}

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  kbd?: string;
  run: () => void;
}
