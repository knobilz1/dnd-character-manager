/**
 * AlternateFormPanel — in-combat section showing active transformation state.
 *
 * Renders up to three sections based on detected class/subclass:
 *  1. Wild Shape (Druid level 2+)          — beast form HP, stats, attacks, revert
 *  2. Path of the Beast (Barbarian, TCE)   — natural weapon selector while raging
 *  3. Armorer (Artificer, TCE)             — Guardian / Infiltrator mode toggle
 */
import React from 'react';
import { RefreshCw, Footprints, Waves, Bird, MountainSnow, Zap, Shield } from 'lucide-react';
import type { ActiveWildShape, Character } from '../types';
import { cn } from '../utils/cn';

// ── Helpers ───────────────────────────────────────────────────────────────────

function abilityMod(score: number) {
  return Math.floor((score - 10) / 2);
}
function fmt(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
}

// ── Wild Shape active panel ───────────────────────────────────────────────────

interface WildShapeActiveProps {
  ws: ActiveWildShape;
  onDamage: (n: number) => void;
  onHeal: (n: number) => void;
  onRevert: () => void;
}

function WildShapeActive({ ws, onDamage, onHeal, onRevert }: WildShapeActiveProps) {
  const [input, setInput] = React.useState('');

  const hpPct = Math.max(0, Math.round((ws.currentHp / ws.maxHp) * 100));
  const hpColor = hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500';

  function apply(mode: 'damage' | 'heal') {
    const n = parseInt(input) || 0;
    if (n <= 0) return;
    mode === 'damage' ? onDamage(n) : onHeal(n);
    setInput('');
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-emerald-400">{ws.name}</span>
          <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded uppercase tracking-wide">{ws.size}</span>
          {ws.cr !== '?' && (
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded uppercase tracking-wide">CR {ws.cr}</span>
          )}
        </div>
        <button
          onClick={onRevert}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors border border-slate-600 hover:border-emerald-600 rounded-lg px-2 py-1"
        >
          <RefreshCw size={11} /> Revert Form
        </button>
      </div>

      {/* HP bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">Beast HP</span>
          <span className="text-sm font-bold text-white tabular-nums">{ws.currentHp} / {ws.maxHp}</span>
        </div>
        <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', hpColor)}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="number"
            min={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') apply('damage');
              if (e.key === 'ArrowUp') apply('heal');
            }}
            placeholder="Amount…"
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-400 tabular-nums"
          />
          <button
            onClick={() => apply('damage')}
            className="px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white text-sm font-medium transition-colors"
          >
            Damage
          </button>
          <button
            onClick={() => apply('heal')}
            className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
          >
            Heal
          </button>
        </div>
        {ws.currentHp === 0 && (
          <p className="text-xs text-red-400 mt-1 font-medium">Beast HP reached 0 — form reverted.</p>
        )}
      </div>

      {/* Stats row: AC, speeds, STR/DEX/CON */}
      <div className="flex flex-wrap gap-2">
        {/* AC */}
        <div className="flex flex-col items-center bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">AC</span>
          <span className="text-sm font-bold text-white">{ws.ac}</span>
          <span className="text-[9px] text-slate-600">beast</span>
        </div>
        {/* Speeds */}
        {ws.speed.walk != null && (
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5">
            <Footprints size={11} className="text-slate-400" />
            <span className="text-xs text-slate-300">{ws.speed.walk}ft</span>
          </div>
        )}
        {ws.speed.swim != null && (
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5">
            <Waves size={11} className="text-slate-400" />
            <span className="text-xs text-slate-300">{ws.speed.swim}ft swim</span>
          </div>
        )}
        {ws.speed.fly != null && (
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5">
            <Bird size={11} className="text-slate-400" />
            <span className="text-xs text-slate-300">{ws.speed.fly}ft fly</span>
          </div>
        )}
        {ws.speed.climb != null && (
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5">
            <MountainSnow size={11} className="text-slate-400" />
            <span className="text-xs text-slate-300">{ws.speed.climb}ft climb</span>
          </div>
        )}
        {ws.speed.burrow != null && (
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5">
            <span className="text-[10px] text-slate-400">⛏</span>
            <span className="text-xs text-slate-300">{ws.speed.burrow}ft burrow</span>
          </div>
        )}
        {/* Beast STR/DEX/CON */}
        {(['str', 'dex', 'con'] as const).map(stat => {
          const score = ws[stat];
          const mod = abilityMod(score);
          return (
            <div key={stat} className="flex flex-col items-center bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{stat}</span>
              <span className="text-sm font-bold text-white">{score}</span>
              <span className="text-[10px] text-slate-400">{fmt(mod)}</span>
            </div>
          );
        })}
      </div>

      {/* Attacks */}
      {ws.attacks.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Attacks</p>
          <div className="space-y-1">
            {ws.attacks.map((atk, i) => (
              <div key={i} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{atk.name}</span>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="text-emerald-400">{fmt(atk.toHit)} to hit</span>
                    <span>·</span>
                    <span>{atk.damage} {atk.damageType}</span>
                    {atk.reach && atk.reach !== 5 && <span>· {atk.reach}ft reach</span>}
                    {atk.range && <span>· {atk.range}</span>}
                  </div>
                </div>
                {atk.notes && (
                  <p className="text-[11px] text-slate-500 mt-0.5">{atk.notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {ws.isCustom && ws.attacks.length === 0 && (
        <p className="text-xs text-slate-500 italic">Custom form — add beast attacks manually.</p>
      )}

      {/* Special abilities */}
      {ws.specialAbilities && ws.specialAbilities.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Special Abilities</p>
          <ul className="space-y-0.5">
            {ws.specialAbilities.map((ab, i) => (
              <li key={i} className="text-xs text-slate-400">• {ab}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Path of the Beast panel ───────────────────────────────────────────────────

interface PathOfBeastProps {
  profBonus: number;
  strMod: number;
  chosenForm: 'bite' | 'claws' | 'tail' | null;
  onChoose: (f: 'bite' | 'claws' | 'tail' | null) => void;
}

const BEAST_FORMS_DATA = {
  bite: {
    label: 'Bite',
    damage: '1d8',
    type: 'Piercing',
    note: 'Regain HP equal to your proficiency bonus once per turn on hit.',
  },
  claws: {
    label: 'Claws',
    damage: '1d6',
    type: 'Slashing',
    note: 'Make one extra attack as part of the Attack action (Multiattack).',
  },
  tail: {
    label: 'Tail',
    damage: '1d8',
    type: 'Piercing',
    note: 'Reach 10 ft. Reaction: add 1d8 to AC against one attack.',
  },
} as const;

function PathOfBeastPanel({ profBonus, strMod, chosenForm, onChoose }: PathOfBeastProps) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">Form of the Beast</p>
      <div className="flex gap-2">
        {(['bite', 'claws', 'tail'] as const).map(f => (
          <button
            key={f}
            onClick={() => onChoose(chosenForm === f ? null : f)}
            className={cn(
              'flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors border',
              chosenForm === f
                ? 'bg-orange-900/60 border-orange-600 text-orange-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500',
            )}
          >
            {BEAST_FORMS_DATA[f].label}
          </button>
        ))}
      </div>
      {chosenForm && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-orange-300">{BEAST_FORMS_DATA[chosenForm].label}</span>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-emerald-400">{fmt(strMod + profBonus)} to hit</span>
              <span>·</span>
              <span>{BEAST_FORMS_DATA[chosenForm].damage}{strMod >= 0 ? `+${strMod}` : strMod} {BEAST_FORMS_DATA[chosenForm].type}</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">{BEAST_FORMS_DATA[chosenForm].note}</p>
        </div>
      )}
    </div>
  );
}

// ── Armorer panel ─────────────────────────────────────────────────────────────

interface ArmorerPanelProps {
  mode: 'guardian' | 'infiltrator';
  profBonus: number;
  strMod: number;
  dexMod: number;
  onSetMode: (m: 'guardian' | 'infiltrator') => void;
}

function ArmorerPanel({ mode, profBonus, strMod, dexMod, onSetMode }: ArmorerPanelProps) {
  // Artificers can use INT instead of STR/DEX for magic weapon attacks (Battle Ready).
  // For Armorer specifically, the weapons are integrated into the armor and generally
  // use STR (Gauntlets) or DEX (Launcher). INT is available if using a magic weapon.
  const guardianHit = strMod + profBonus;
  const infiltratorHit = dexMod + profBonus;

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">Armor Model</p>
      <div className="flex gap-2">
        {(['guardian', 'infiltrator'] as const).map(m => (
          <button
            key={m}
            onClick={() => onSetMode(m)}
            className={cn(
              'flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors border capitalize',
              mode === m
                ? 'bg-blue-900/60 border-blue-600 text-blue-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500',
            )}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === 'guardian' ? (
        <div className="space-y-1.5">
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-300">Thunder Gauntlets</span>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="text-emerald-400">{fmt(guardianHit)} to hit</span>
                <span>·</span>
                <span>1d8 thunder · melee</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">On hit, the target has disadvantage on attacks against targets other than you until the start of your next turn (magical).</p>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <Shield size={12} className="text-blue-400 shrink-0" />
              <span className="text-xs text-slate-300">Defensive Field — bonus action: gain temp HP equal to artificer level.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-300">Lightning Launcher</span>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="text-emerald-400">{fmt(infiltratorHit)} to hit</span>
                <span>·</span>
                <span>1d6 lightning · 30/120 ft</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Once per turn: deal extra 1d6 lightning on hit (magical). Target sheds dim light 5 ft until start of your next turn.</p>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center gap-2">
              <Zap size={12} className="text-blue-400 shrink-0" />
              <span className="text-xs text-slate-300">Powered Steps: +5 ft walking speed.</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield size={12} className="text-blue-400 shrink-0" />
              <span className="text-xs text-slate-300">Dampening Field: advantage on Dexterity (Stealth) checks.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface AlternateFormPanelProps {
  character: Character;
  // Feature flags
  isDruid: boolean;
  druidLevel: number;
  isPathOfBeast: boolean;
  isArmorer: boolean;
  // Wild Shape
  onOpenWildShapeModal: () => void;
  deactivateWildShape: () => void;
  damageWildShape: (n: number) => void;
  healWildShape: (n: number) => void;
  // Path of Beast
  isRaging: boolean;
  setPathOfBeastForm: (f: 'bite' | 'claws' | 'tail' | null) => void;
  // Armorer
  setArmorerMode: (m: 'guardian' | 'infiltrator') => void;
  // Derived stats
  mods: Record<string, number>;
  profBonus: number;
}

export function AlternateFormPanel({
  character, isDruid, druidLevel, isPathOfBeast, isArmorer,
  onOpenWildShapeModal, deactivateWildShape, damageWildShape, healWildShape,
  isRaging, setPathOfBeastForm, setArmorerMode, mods, profBonus,
}: AlternateFormPanelProps) {
  const ws = character.activeWildShape ?? null;

  // Find remaining wild shape uses
  const wsResource = character.resources?.find(r => r.key === 'wild_shape');
  const wsUsesLeft = wsResource ? wsResource.current : 0;
  const wsUsesMax = wsResource ? wsResource.max : 0;

  return (
    <div className="space-y-3">
      {/* ── Wild Shape ────────────────────────────────────────────────── */}
      {isDruid && (
        <div className="bg-slate-800 border border-emerald-900/50 rounded-xl px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">🐾 Wild Shape</span>
            {!ws && wsResource && (
              <span className="text-[11px] text-slate-500">{wsUsesLeft}/{wsUsesMax} uses</span>
            )}
          </div>

          {ws ? (
            <WildShapeActive
              ws={ws}
              onDamage={damageWildShape}
              onHeal={healWildShape}
              onRevert={deactivateWildShape}
            />
          ) : (
            <button
              onClick={onOpenWildShapeModal}
              disabled={druidLevel < 2 || wsUsesLeft === 0}
              className={cn(
                'w-full py-2.5 rounded-lg border font-medium text-sm transition-colors',
                druidLevel >= 2 && wsUsesLeft > 0
                  ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300 hover:bg-emerald-900/70'
                  : 'bg-slate-700/40 border-slate-600 text-slate-500 cursor-not-allowed',
              )}
            >
              {druidLevel < 2
                ? 'Wild Shape (available at level 2)'
                : wsUsesLeft === 0
                ? 'Wild Shape (no uses remaining)'
                : '🐾 Wild Shape — Transform'}
            </button>
          )}
        </div>
      )}

      {/* ── Path of the Beast ─────────────────────────────────────────── */}
      {isPathOfBeast && isRaging && (
        <div className="bg-slate-800 border border-orange-900/50 rounded-xl px-4 py-3">
          <PathOfBeastPanel
            profBonus={profBonus}
            strMod={mods.str ?? 0}
            chosenForm={character.pathOfBeastForm ?? null}
            onChoose={setPathOfBeastForm}
          />
        </div>
      )}

      {/* ── Armorer ───────────────────────────────────────────────────── */}
      {isArmorer && (
        <div className="bg-slate-800 border border-blue-900/50 rounded-xl px-4 py-3">
          <ArmorerPanel
            mode={character.armorerMode ?? 'guardian'}
            profBonus={profBonus}
            strMod={mods.str ?? 0}
            dexMod={mods.dex ?? 0}
            onSetMode={setArmorerMode}
          />
        </div>
      )}
    </div>
  );
}
