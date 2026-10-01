/**
 * Writes combat results back onto actors and reports them to chat.
 */

import { SYSTEM_ID, chatTemplate } from '../constants.ts';
import { STATUS_DEFS, applyStatus, clearStatusesOnKO } from '../effects/statuses.ts';
import type { CombatForecast, CombatResult, CombatSide, UnitProfile } from '../../types/hol.ts';

/** Grid distance between two tokens, measured in tiles. */
export function tokenDistance(a: Token, b: Token): number {
  const grid = a?.scene?.grid ?? canvas?.grid;
  const size = grid?.size ?? 100;
  const distancePerTile = grid?.distance ?? 1;

  const ax = a.document.x / size;
  const ay = a.document.y / size;
  const bx = b.document.x / size;
  const by = b.document.y / size;

  // Fire Emblem measures in orthogonal steps, so use Manhattan distance between
  // the nearest occupied squares rather than Euclidean range.
  const aw = a.document.width ?? 1;
  const ah = a.document.height ?? 1;
  const bw = b.document.width ?? 1;
  const bh = b.document.height ?? 1;

  const dx = Math.max(0, Math.max(ax - (bx + bw - 1), bx - (ax + aw - 1)));
  const dy = Math.max(0, Math.max(ay - (by + bh - 1), by - (ay + ah - 1)));
  return Math.round((dx + dy) * (distancePerTile / (grid?.distance ?? 1)));
}

export interface ApplyCombatArgs {
  attackerToken: Token;
  defenderToken: Token;
  forecast: CombatForecast;
  profiles?: Partial<Record<CombatSide, UnitProfile>>;
  result: CombatResult;
  /** The pooled roll, so the dice land in Foundry's log. */
  roll?: Roll | null;
}

/** Apply HP, status, and Charge changes, then post the combat card. */
export async function applyCombatResult(
  { attackerToken, defenderToken, forecast, profiles = {}, result, roll = null }: ApplyCombatArgs
): Promise<void> {
  const tokens: Record<CombatSide, Token> = { attacker: attackerToken, defender: defenderToken };

  for (const side of ['attacker', 'defender'] as CombatSide[]) {
    const actor = tokens[side].actor;
    if (!actor) continue;

    const update: Record<string, unknown> = { 'system.resources.hp.value': result.hp[side] };
    const charge = result.chargeGained[side];
    if (charge) update['system.charge'] = (actor.system.charge ?? 0) + charge;

    await actor.update(update);

    // Statuses land after the exchange (rules p.29) and are owned by whoever
    // inflicted them, so their phase is the one that counts them down.
    const inflicted = result.postCombat.find(entry => entry.target === side && entry.type === 'status');
    if (inflicted?.status) {
      const sourceSide: CombatSide = side === 'attacker' ? 'defender' : 'attacker';
      await applyStatus(actor, inflicted.status, {
        source: tokens[sourceSide].actor,
        phaseOwner: tokens[sourceSide].document?.disposition ?? null,
        profile: profiles[side] ?? null
      });
    }

    // A unit at 0 HP sheds every status, Injured included (rules p.29).
    if (result.hp[side] <= 0) await clearStatusesOnKO(actor);
  }

  await postCombatCard({ attackerToken, defenderToken, forecast, result, roll });
}

async function postCombatCard(
  { attackerToken, defenderToken, forecast, result, roll }: Required<Pick<ApplyCombatArgs, 'attackerToken' | 'defenderToken' | 'forecast' | 'result'>> & { roll: Roll | null }
): Promise<void> {
  const content = await foundry.applications.handlebars.renderTemplate(chatTemplate('combat-result.html'), {
    attacker: {
      name: attackerToken.name,
      img: attackerToken.document?.texture?.src ?? attackerToken.actor?.img,
      weapon: forecast.attacker.weaponName,
      hp: result.hp.attacker,
      maxHp: attackerToken.actor?.system?.totals?.hp ?? 0,
      defeated: result.defeated.attacker
    },
    defender: {
      name: defenderToken.name,
      img: defenderToken.document?.texture?.src ?? defenderToken.actor?.img,
      weapon: forecast.defender.weaponName,
      hp: result.hp.defender,
      defeated: result.defeated.defender
    },
    strikes: result.log.map(entry => ({
      ...entry,
      actorName: entry.side === 'attacker' ? attackerToken.name : defenderToken.name,
      diceText: entry.dice.join(' / '),
      modeLabel: entry.mode === 'advantage' ? 'ADV' : entry.mode === 'disadvantage' ? 'DIS' : ''
    })),
    postCombat: result.postCombat.map(entry => ({
      ...entry,
      targetName: entry.target === 'attacker' ? attackerToken.name : defenderToken.name,
      statusLabel: entry.status ? STATUS_DEFS[entry.status]?.label ?? entry.status : ''
    })),
    triangle: forecast.attacker.triangle,
    effective: forecast.attacker.effective,
    attackerSkills: forecast.attacker.activeSkills ?? [],
    defenderSkills: forecast.defender.activeSkills ?? []
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attackerToken.document }),
    content,
    // Attaching the Roll keeps the dice in Foundry's roll log and lets Dice So Nice animate them.
    rolls: roll ? [roll] : [],
    sound: roll ? CONFIG.sounds.dice : undefined,
    flags: { [SYSTEM_ID]: { combat: true } }
  });
}

/**
 * Roll every die the exchange needs in one go so the engine can stay synchronous.
 */
export async function rollDicePool(count: number): Promise<{ next: () => number; roll: Roll | null }> {
  if (count <= 0) return { next: (): number => Math.ceil(Math.random() * 20), roll: null };

  const roll = await new Roll(`${count}d20`).evaluate();
  const values = roll.dice[0]?.results?.map(result => result.result) ?? [];
  let index = 0;
  return { next: (): number => values[index++] ?? Math.ceil(Math.random() * 20), roll };
}

/** How many d20s a forecast will consume, accounting for advantage and disadvantage. */
export function diceNeeded(forecast: CombatForecast): number {
  return forecast.order.reduce(
    (total, entry) => total + (forecast[entry.side].mode === 'normal' ? 1 : 2),
    0
  );
}
