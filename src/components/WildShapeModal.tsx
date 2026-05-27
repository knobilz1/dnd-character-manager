import React from 'react';
import { Search, Footprints, Waves, Bird, MountainSnow, ChevronDown, ChevronRight } from 'lucide-react';
import { Dialog } from './ui';
import {
  ALL_BEAST_FORMS,
  ELEMENTAL_FORMS,
  CR_ORDER,
  crLabel,
  canUseBeast,
  beastFormToActive,
  getBeastFormsByCR,
  type BeastForm,
} from '../data/beastForms';
import type { ActiveWildShape } from '../types';

interface WildShapeModalProps {
  open: boolean;
  onClose: () => void;
  druidLevel: number;
  isMoon: boolean;
  onActivate: (form: ActiveWildShape) => void;
}

export function WildShapeModal({ open, onClose, druidLevel, isMoon, onActivate }: WildShapeModalProps) {
  const [search, setSearch] = React.useState('');
  const [expandedCRs, setExpandedCRs] = React.useState<Set<string>>(() => new Set(['0', '1/8', '1/4', '1/2', '1']));
  const [customMode, setCustomMode] = React.useState(false);
  const [custom, setCustom] = React.useState({ name: '', hp: 10, ac: 10, str: 10, dex: 10, con: 10 });

  const byCR = getBeastFormsByCR();

  const availableBeasts = ALL_BEAST_FORMS.filter(b => canUseBeast(b, druidLevel, isMoon));
  const showElementals = isMoon && druidLevel >= 10;

  function toggleCR(cr: string) {
    setExpandedCRs(prev => {
      const next = new Set(prev);
      next.has(cr) ? next.delete(cr) : next.add(cr);
      return next;
    });
  }

  function handleActivate(beast: BeastForm) {
    onActivate(beastFormToActive(beast));
    onClose();
  }

  function handleCustomActivate() {
    if (!custom.name.trim()) return;
    const form: ActiveWildShape = {
      id: 'custom',
      name: custom.name.trim(),
      cr: '?',
      size: 'Medium',
      maxHp: custom.hp,
      currentHp: custom.hp,
      ac: custom.ac,
      str: custom.str,
      dex: custom.dex,
      con: custom.con,
      speed: { walk: 30 },
      attacks: [],
      isCustom: true,
    };
    onActivate(form);
    onClose();
  }

  const speedIcons = (beast: BeastForm) => (
    <span className="flex items-center gap-1 text-slate-400">
      {beast.speed.walk != null && <span className="flex items-center gap-0.5 text-[10px]"><Footprints size={10} />{beast.speed.walk}ft</span>}
      {beast.speed.swim != null && <span className="flex items-center gap-0.5 text-[10px]"><Waves size={10} />{beast.speed.swim}ft</span>}
      {beast.speed.fly  != null && <span className="flex items-center gap-0.5 text-[10px]"><Bird size={10} />{beast.speed.fly}ft</span>}
      {beast.speed.climb != null && <span className="flex items-center gap-0.5 text-[10px]"><MountainSnow size={10} />{beast.speed.climb}ft</span>}
    </span>
  );

  const BeastCard = ({ beast }: { beast: BeastForm }) => (
    <button
      onClick={() => handleActivate(beast)}
      className="w-full text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-600 rounded-lg px-3 py-2 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">{beast.name}</span>
          <span className="ml-2 text-[10px] text-slate-500 uppercase">{beast.size}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-400">
          <span>HP {beast.hp}</span>
          <span>AC {beast.ac}</span>
        </div>
      </div>
      <div className="mt-0.5">{speedIcons(beast)}</div>
    </button>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Wild Shape — Choose Form">
      <div className="flex flex-col gap-3 w-full" style={{ maxHeight: '65vh' }}>
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search beasts…"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Beast list */}
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {search.trim() ? (
            // Flat filtered list
            <div className="space-y-1.5">
              {availableBeasts.filter(b => b.name.toLowerCase().includes(search.toLowerCase())).map(b => (
                <BeastCard key={b.id} beast={b} />
              ))}
              {showElementals && ELEMENTAL_FORMS.filter(b => b.name.toLowerCase().includes(search.toLowerCase())).map(b => (
                <BeastCard key={b.id} beast={b} />
              ))}
            </div>
          ) : (
            // Grouped by CR
            <>
              {CR_ORDER.map(crKey => {
                const beasts = (byCR[crKey] ?? []).filter(b => canUseBeast(b, druidLevel, isMoon));
                if (beasts.length === 0) return null;
                const expanded = expandedCRs.has(crKey);
                return (
                  <div key={crKey}>
                    <button
                      onClick={() => toggleCR(crKey)}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide hover:text-white transition-colors"
                    >
                      <span>{crLabel(crKey)}</span>
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    {expanded && (
                      <div className="space-y-1.5 ml-1">
                        {beasts.map(b => <BeastCard key={b.id} beast={b} />)}
                      </div>
                    )}
                  </div>
                );
              })}

              {showElementals && (
                <div>
                  <button
                    onClick={() => toggleCR('elemental')}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-purple-400 uppercase tracking-wide hover:text-purple-200 transition-colors"
                  >
                    <span>Elemental Forms (Circle of the Moon)</span>
                    {expandedCRs.has('elemental') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {expandedCRs.has('elemental') && (
                    <div className="space-y-1.5 ml-1">
                      {ELEMENTAL_FORMS.map(b => <BeastCard key={b.id} beast={b} />)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Custom form toggle */}
        <div className="border-t border-slate-700 pt-2">
          <button
            onClick={() => setCustomMode(v => !v)}
            className="text-xs text-slate-400 hover:text-white transition-colors underline"
          >
            {customMode ? 'Hide custom form' : '+ Enter custom form'}
          </button>
          {customMode && (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                placeholder="Beast name"
                value={custom.name}
                onChange={e => setCustom(c => ({ ...c, name: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <div className="grid grid-cols-3 gap-2">
                {(['hp', 'ac', 'str', 'dex', 'con'] as const).map(field => (
                  <div key={field}>
                    <label className="text-[10px] text-slate-400 uppercase tracking-wide">{field.toUpperCase()}</label>
                    <input
                      type="number"
                      min={1}
                      value={(custom as any)[field]}
                      onChange={e => setCustom(c => ({ ...c, [field]: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={handleCustomActivate}
                disabled={!custom.name.trim()}
                className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Transform into {custom.name || '…'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
