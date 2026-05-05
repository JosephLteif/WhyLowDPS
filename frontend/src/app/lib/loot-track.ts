export const TRACK_COLORS: Record<string, { text: string; bg: string; border: string; badge?: string }> = {
  Adventurer: {
    text: 'text-green-400',
    bg: 'bg-green-400/10',
    border: 'border-green-400/30',
    badge: 'bg-surface-2 text-white border-border',
  },
  Veteran: {
    text: 'text-blue-400',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/30',
    badge: 'bg-surface-2 text-white border-border',
  },
  Champion: {
    text: 'text-purple-400',
    bg: 'bg-purple-400/10',
    border: 'border-purple-400/30',
    badge: 'bg-surface-2 text-white border-border',
  },
  Hero: {
    text: 'text-orange-400',
    bg: 'bg-orange-400/10',
    border: 'border-orange-400/30',
    badge: 'bg-surface-2 text-white border-border',
  },
  Myth: {
    text: 'text-amber-300',
    bg: 'bg-amber-300/10',
    border: 'border-amber-300/30',
    badge: 'bg-surface-2 text-white border-border',
  },
  Crafted: {
    text: 'text-cyan-400',
    bg: 'bg-cyan-400/10',
    border: 'border-cyan-400/30',
    badge: 'bg-surface-2 text-white border-border',
  },
};

export const RAID_TRACK_BY_DIFFICULTY: Record<string, string> = {
  lfr: 'Veteran',
  normal: 'Champion',
  heroic: 'Hero',
  mythic: 'Myth',
};

export const DEFAULT_TRACK_BADGE_CLASS = 'bg-surface-2 text-white border-border';
