import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../components/SimContext';
import { API_URL, fetchJson } from './api';
import type { FightScenario } from './types';
import { storeScenarioSiblings, clearScenarioSiblings } from './scenario-siblings';
import { simResultHref } from './routes';
import { buildFightStylePayload } from './fight-style';
import {
  buildCurrentReturnUrl,
  registerSimReturnTarget,
  registerSimReturnTargets,
} from './sim-return';

interface UseSimSubmitOptions {
  /** API endpoint path, e.g. "/api/sim" */
  endpoint: string;
  /**
   * Build per-page payload fields (merged into the shared payload).
   * Return null to abort submission.
   */
  buildPayload: () => Record<string, unknown> | Promise<Record<string, unknown> | null> | null;
  /** Optional pre-submit validation. Return an error string to abort. */
  validate?: () => string | null;
  /** Optional Sim Again metadata for restoring page-local state. */
  simAgain?: {
    pageKey?: string;
    returnUrl?: string;
    captureState?: () => unknown;
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeRealm(realm: string): string {
  return realm
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[\s_-]+/g, '');
}

function extractSimcIdentity(
  simcInput: string
): { name: string; realm: string; region: string } | null {
  const lines = simcInput.split(/\r?\n/);
  let name = '';
  let realm = '';
  let region = 'us';

  const classLine =
    /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker|player|name)\s*=\s*"?([^"\s,]+)"?/i;
  const armoryLine = /^armory\s*=\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)\s*$/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const armory = line.match(armoryLine);
    if (armory) {
      region = armory[1].toLowerCase();
      realm = armory[2];
      name = armory[3];
      break;
    }

    if (!name) {
      const cls = line.match(classLine);
      if (cls) name = cls[1];
    }
    if (!realm && line.toLowerCase().startsWith('server=')) {
      realm = line.slice(7).trim().replace(/^"|"$/g, '');
    }
    if (line.toLowerCase().startsWith('region=')) {
      region = line.slice(7).trim().replace(/^"|"$/g, '').toLowerCase() || 'us';
    }
  }

  if (!name || !realm) return null;
  return { name, realm, region };
}

export function useSimSubmit({ endpoint, buildPayload, validate, simAgain }: UseSimSubmitOptions) {
  const router = useRouter();
  const {
    simcInput,
    fightStyle,
    threads,
    selectedTalent,
    targetCount,
    fightLength,
    customApl,
    simcChannel,
    includeTimeline,
    externalBuffChaosBrand,
    externalBuffMysticTouch,
    externalBuffSkyfury,
    externalBuffPowerInfusion,
    externalBuffBlessingOfBronze,
    externalBuffAugmentation,
    raidBuffBloodlust,
    raidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    raidBuffBattleShout,
    raidBuffHuntersMark,
    raidBuffBleeding,
    consumableFlask,
    consumableFood,
    consumablePotion,
    consumableAugmentation,
    consumableTemporaryEnchant,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    scenarios,
    clearScenarios,
  } = useSimContext();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const autoLinkJobToCharacter = useCallback(
    async (jobId: string) => {
      const identity = extractSimcIdentity(simcInput);
      if (!identity) return;

      try {
        const data = await fetchJson<{
          characters: Array<{ name: string; realm: string; region: string }>;
        }>(`${API_URL}/api/bnet/user/characters`);
        const characters = Array.isArray(data as unknown)
          ? (data as unknown as Array<{ name: string; realm: string; region: string }>)
          : data?.characters || [];

        const match = characters.find((c) => {
          return (
            normalizeName(c.name) === normalizeName(identity.name) &&
            normalizeRealm(c.realm) === normalizeRealm(identity.realm) &&
            (c.region || '').toLowerCase() === identity.region.toLowerCase()
          );
        });

        if (!match) return;

        await fetchJson(`${API_URL}/api/sim/${jobId}/link`, {
          method: 'POST',
          body: JSON.stringify({
            name: match.name,
            realm: match.realm,
            region: match.region,
          }),
        });
      } catch {
        // Keep job unlinked when roster is unavailable/not authenticated.
      }
    },
    [simcInput]
  );

  const submit = useCallback(async () => {
    setError('');

    if (validate) {
      const err = validate();
      if (err) {
        setError(err);
        return;
      }
    }

    const pagePayload = await buildPayload();
    if (pagePayload === null) return;
    const isConsumableMatrix = pagePayload.sim_type === 'consumable_matrix';
    let simAgainTarget: { returnUrl: string; pageKey?: string; state?: unknown } | null = null;
    if (typeof window !== 'undefined') {
      const returnUrl = (simAgain?.returnUrl || buildCurrentReturnUrl()).trim();
      const pageKey = simAgain?.pageKey?.trim();
      let state: unknown = undefined;
      if (simAgain?.captureState) {
        try {
          state = simAgain.captureState();
        } catch {
          state = undefined;
        }
      }
      if (returnUrl) {
        simAgainTarget = {
          returnUrl,
          ...(pageKey ? { pageKey } : {}),
          ...(state !== undefined ? { state } : {}),
        };
      }
    }

    setSubmitting(true);
    clearScenarioSiblings();

    try {
      const configs: FightScenario[] =
        scenarios.length > 0 ? scenarios : [{ id: '', fightStyle, targetCount, fightLength }];

      const batchId = scenarios.length > 0 ? crypto.randomUUID() : undefined;

      const sharedPayload = {
        ...pagePayload,
        iterations: 10000,
        target_error: 0.1,
        threads,
        simc_channel: simcChannel || 'weekly',
        ...(batchId ? { batch_id: batchId } : {}),
        ...(selectedTalent ? { talents: selectedTalent } : {}),
        ...(customApl ? { custom_apl: customApl } : {}),
        ...(simcHeader ? { simc_header: simcHeader } : {}),
        ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
        ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
        ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
        ...(simcFooter ? { simc_footer: simcFooter } : {}),
        ...(includeTimeline ? { include_timeline: true } : { include_timeline: false }),
        ...(externalBuffChaosBrand ? { external_buff_chaos_brand: true } : {}),
        ...(externalBuffMysticTouch ? { external_buff_mystic_touch: true } : {}),
        ...(externalBuffSkyfury ? { external_buff_skyfury: true } : {}),
        ...(externalBuffPowerInfusion ? { external_buff_power_infusion: true } : {}),
        ...(externalBuffBlessingOfBronze ? { external_buff_blessing_of_bronze: true } : {}),
        ...(externalBuffAugmentation ? { external_buff_augmentation: true } : {}),
        raid_buff_customized: true,
        raid_buff_bloodlust: raidBuffBloodlust,
        raid_buff_arcane_intellect: raidBuffArcaneIntellect,
        raid_buff_power_word_fortitude: raidBuffPowerWordFortitude,
        raid_buff_mark_of_the_wild: raidBuffMarkOfTheWild,
        raid_buff_battle_shout: raidBuffBattleShout,
        raid_buff_hunters_mark: raidBuffHuntersMark,
        raid_buff_bleeding: raidBuffBleeding,
        ...(!isConsumableMatrix && consumableFlask.trim()
          ? { consumable_flask: consumableFlask.trim() }
          : {}),
        ...(!isConsumableMatrix && consumableFood.trim()
          ? { consumable_food: consumableFood.trim() }
          : {}),
        ...(!isConsumableMatrix && consumablePotion.trim()
          ? { consumable_potion: consumablePotion.trim() }
          : {}),
        ...(!isConsumableMatrix && consumableAugmentation.trim()
          ? { consumable_augmentation: consumableAugmentation.trim() }
          : {}),
        ...(!isConsumableMatrix && consumableTemporaryEnchant.trim()
          ? { consumable_temporary_enchant: consumableTemporaryEnchant.trim() }
          : {}),
      };

      const results = await Promise.allSettled(
        configs.map(async (config) => {
          return fetchJson<any>(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sharedPayload,
              fight_style: config.fightStyle,
              ...buildFightStylePayload(config.fightStyle, config.targetCount, config.fightLength),
            }),
          });
        })
      );

      if (scenarios.length === 0) {
        const r = results[0];
        if (r.status === 'fulfilled') {
          if (simAgainTarget) {
            registerSimReturnTarget(r.value.id, simAgainTarget);
          }
          void autoLinkJobToCharacter(r.value.id);
          router.push(simResultHref(r.value.id));
        } else {
          throw r.reason;
        }
      } else {
        const siblings = configs
          .map((config, i) => {
            const r = results[i];
            return r.status === 'fulfilled'
              ? {
                  id: r.value.id,
                  fightStyle: config.fightStyle,
                  targetCount: config.targetCount,
                  fightLength: config.fightLength,
                }
              : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        if (siblings.length > 0) {
          if (simAgainTarget) {
            registerSimReturnTargets(
              siblings.map((s) => s.id),
              simAgainTarget
            );
          }
          siblings.forEach((s) => {
            void autoLinkJobToCharacter(s.id);
          });
          storeScenarioSiblings(siblings);
          clearScenarios();
          router.push(simResultHref(siblings[0].id));
        } else {
          throw new Error('All scenario submissions failed');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit sim');
    } finally {
      setSubmitting(false);
    }
  }, [
    endpoint,
    buildPayload,
    validate,
    router,
    fightStyle,
    threads,
    selectedTalent,
    targetCount,
    fightLength,
    customApl,
    simcChannel,
    includeTimeline,
    externalBuffChaosBrand,
    externalBuffMysticTouch,
    externalBuffSkyfury,
    externalBuffPowerInfusion,
    externalBuffBlessingOfBronze,
    externalBuffAugmentation,
    raidBuffBloodlust,
    raidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    raidBuffBattleShout,
    raidBuffHuntersMark,
    raidBuffBleeding,
    consumableFlask,
    consumableFood,
    consumablePotion,
    consumableAugmentation,
    consumableTemporaryEnchant,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    scenarios,
    clearScenarios,
    autoLinkJobToCharacter,
    simAgain,
  ]);

  const buttonLabel = useCallback(
    (defaultLabel: string) =>
      scenarios.length > 0
        ? `Run ${scenarios.length} Scenario${scenarios.length > 1 ? 's' : ''}`
        : defaultLabel,
    [scenarios.length]
  );

  return { submit, submitting, error, setError, buttonLabel };
}
