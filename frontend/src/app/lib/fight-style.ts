export interface FightStyleParamRules {
  usesFightLength: boolean;
  usesTargetCount: boolean;
}

const DEFAULT_RULES: FightStyleParamRules = {
  usesFightLength: true,
  usesTargetCount: true,
};

const FIGHT_STYLE_RULES: Record<string, FightStyleParamRules> = {
  DungeonSlice: { usesFightLength: false, usesTargetCount: false },
  DungeonRoute: { usesFightLength: false, usesTargetCount: false },
};

export function getFightStyleParamRules(fightStyle: string): FightStyleParamRules {
  return FIGHT_STYLE_RULES[fightStyle] || DEFAULT_RULES;
}

export function buildFightStylePayload(
  fightStyle: string,
  targetCount: number,
  fightLength: number
): Record<string, number> {
  const rules = getFightStyleParamRules(fightStyle);
  const payload: Record<string, number> = {};
  if (rules.usesTargetCount) payload.desired_targets = targetCount;
  if (rules.usesFightLength) payload.max_time = fightLength;
  return payload;
}
