import type { BlizzardItem } from './simc-generator';

export type CharacterStatisticsPayload = Record<string, unknown> | null;
export type MythicPlusPayload = Record<string, unknown> | null;

export type CharacterPanelEquipment = {
  equipped_items: BlizzardItem[];
};

export type CharacterTalentSelection = {
  id?: number;
  rank?: number;
  talent?: { id?: number; name?: string };
  tooltip_spell?: { id?: number; name?: string };
  spell_tooltip?: { spell?: { id?: number } };
  selected_tooltip?: { spell?: { id?: number } };
};

export type CharacterTalentLoadout = {
  is_active?: boolean;
  talent_loadout_code?: string;
  talentLoadoutCode?: string;
  loadout_code?: string;
  code?: string;
  selected_class_talents?: CharacterTalentSelection[];
  selected_spec_talents?: CharacterTalentSelection[];
  selected_hero_talents?: CharacterTalentSelection[];
};

export type CharacterSpecialization = {
  specialization?: {
    id?: number;
    name?: string;
  };
  loadouts?: CharacterTalentLoadout[];
  talents?: CharacterTalentSelection[];
  talent_loadout_code?: string;
  talentLoadoutCode?: string;
};

export type CharacterSpecializationsPayload = {
  active_specialization?: {
    id?: number;
  };
  specializations?: CharacterSpecialization[];
};

export type CharacterRunMember = {
  linked_name?: string;
  linked_region?: string;
  linked_realm?: string;
  linked_profile_url?: string;
  character_name?: string;
  name?: string;
  region?: string;
  realm?: string;
  url?: string;
  profile?: {
    name?: string;
    region?: string;
    url?: string;
    realm?: {
      slug?: string;
      name?: string;
      region?: string;
    };
    character_class?: {
      name?: string;
    };
  };
  character?: {
    name?: string;
    region?: string;
    url?: string;
    realm?: {
      slug?: string;
      name?: string;
      region?: string;
    };
  };
  specialization?: {
    name?: string;
  };
  character_class?: {
    name?: string;
  };
  class?: {
    name?: string;
  } | string;
};

export type MythicRun = {
  keystone_level?: number;
  keystoneLevel?: number;
  keystone_dungeon?: { name?: string };
  dungeon?: { name?: string };
  completed_challenge_mode?: { name?: string };
  name?: string;
  duration?: number;
  run_duration?: number;
  is_completed_within_timeout?: boolean;
  completed_in_time?: boolean;
  completedWithinTime?: boolean;
  completed_timestamp?: number;
  completedTimestamp?: number;
  end_timestamp?: number;
  endTimestamp?: number;
  start_timestamp?: number;
  startTimestamp?: number;
  timestamp?: number;
  members?: CharacterRunMember[];
  [key: string]: unknown;
};

export type RaidEncounterProgress = {
  last_kill_timestamp?: number;
};

export type RaidModeProgress = {
  encounters_defeated?: number;
  completed_count?: number;
  total_encounters?: number;
  total_count?: number;
  encounters?: RaidEncounterProgress[];
};

export type RaidMode = {
  difficulty?: { type?: string };
  progress?: RaidModeProgress;
};

export type RaidInstance = {
  instance?: { name?: string };
  name?: string;
  modes?: RaidMode[];
};

export type RaidExpansion = {
  expansion?: { name?: string };
  expansion_name?: string;
  label?: string;
  name?: string;
  instances?: RaidInstance[];
};

export type RaidEncountersPayload = {
  expansions?: RaidExpansion[];
  [key: string]: unknown;
} | null;
