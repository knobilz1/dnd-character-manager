import React from 'react';
import { Plus, X, Shield, Sword, Pencil, RotateCcw } from 'lucide-react';
import { Button, Dialog, HoverCard, SectionHeader } from '../../components/ui';
import { cn } from '../../utils/cn';
import type { Character, InventoryItem, ItemCategory } from '../../types';
import { searchItems, type ItemTemplate } from '../../data/items';
import { TOWN_STORE } from '../../data/townStore';

const CATEGORY_BADGE: Record<ItemCategory, string> = {
  weapon: 'bg-red-900/30 text-red-300 border-red-700/40',
  armor: 'bg-slate-700 text-slate-200 border-slate-500',
  shield: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
  tool: 'bg-blue-900/30 text-blue-300 border-blue-700/40',
  pack: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
  consumable: 'bg-purple-900/30 text-purple-300 border-purple-700/40',
  gear: 'bg-indigo-900/30 text-indigo-300 border-indigo-700/40',
  treasure: 'bg-yellow-900/30 text-yellow-300 border-yellow-700/40',
  magic: 'bg-pink-900/30 text-pink-300 border-pink-700/40',
  other: 'bg-slate-700 text-slate-300 border-slate-500',
};

const CATEGORY_ORDER: ItemCategory[] = [
  'weapon', 'armor', 'shield', 'pack', 'tool', 'gear', 'consumable', 'magic', 'treasure', 'other'
];

interface InventoryPanelProps {
  character: Character;
  strScore: number;
  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => void;
  removeInventoryItem: (id: string) => void;
  setInventoryQuantity: (id: string, qty: number) => void;
  toggleInventoryEquipped: (id: string) => void;
  renameInventoryItem: (id: string, name: string) => void;
  setInventoryDescription: (id: string, description: string | undefined) => void;
  setItemCharges: (id: string, charges: number) => void;
  updateCurrency: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
}

export function InventoryPanel({
  character,
  strScore,
  addInventoryItem,
  removeInventoryItem,
  setInventoryQuantity,
  toggleInventoryEquipped,
  renameInventoryItem,
  setInventoryDescription,
  setItemCharges,
  updateCurrency,
}: InventoryPanelProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [draftItem, setDraftItem] = React.useState<{
    name: string; quantity: number; category: ItemCategory; weight?: number; description?: string; maxCharges?: number; recharge?: 'dawn' | 'long' | 'short';
  }>({ name: '', quantity: 1, category: 'gear' });
  const [suggestions, setSuggestions] = React.useState<ItemTemplate[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);

  const inventory = character.inventory ?? [];

  // Group by category
  const byCategory: Partial<Record<ItemCategory, InventoryItem[]>> = {};
  for (const item of inventory) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category]!.push(item);
  }

  const totalWeight = inventory.reduce(
    (sum, i) => sum + (i.weight ?? 0) * i.quantity, 0
  );

  const carryCapacity = strScore * 15;
  const lightThresh  = strScore * 5;
  const heavyThresh  = strScore * 10;
  const isLightly = totalWeight > lightThresh;
  const isHeavy   = totalWeight > heavyThresh;
  const isOverCap = totalWeight > carryCapacity;
  const encPct = carryCapacity > 0 ? Math.min(totalWeight / carryCapacity, 1) : 0;
  const barColor = isOverCap ? 'bg-red-500' : isHeavy ? 'bg-orange-500' : isLightly ? 'bg-yellow-400' : 'bg-blue-400';
  const weightColor = isOverCap ? 'text-red-400' : isHeavy ? 'text-orange-400' : isLightly ? 'text-yellow-300' : 'text-white';
  const encLabel = isOverCap ? 'Over Capacity' : isHeavy ? 'Heavily Encumbered' : isLightly ? 'Lightly Encumbered' : null;
  const encBadge = isOverCap
    ? 'bg-red-900/40 text-red-300 border border-red-700/50'
    : isHeavy
      ? 'bg-orange-900/40 text-orange-300 border border-orange-700/50'
      : 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50';

  function handleAdd() {
    if (!draftItem.name.trim()) return;
    const mc = draftItem.maxCharges && draftItem.maxCharges > 0 ? draftItem.maxCharges : undefined;
    addInventoryItem({
      name: draftItem.name.trim(),
      quantity: Math.max(1, draftItem.quantity),
      category: draftItem.category,
      weight: draftItem.weight,
      description: draftItem.description,
      maxCharges: mc,
      charges: mc,
      recharge: draftItem.recharge,
    });
    setDraftItem({ name: '', quantity: 1, category: 'gear' });
    setSuggestions([]);
    setShowSuggestions(false);
    setAddOpen(false);
  }

  function handleNameChange(value: string) {
    setDraftItem(d => ({ ...d, name: value }));
    const hits = searchItems(value, character.enabledBooks, 8);
    setSuggestions(hits);
    setShowSuggestions(hits.length > 0);
  }

  function selectSuggestion(item: ItemTemplate) {
    setDraftItem(d => ({
      ...d,
      name: item.name,
      category: item.category,
      weight: item.weight,
      description: item.description ?? d.description,
      maxCharges: item.maxCharges,
      recharge: item.recharge,
    }));
    setSuggestions([]);
    setShowSuggestions(false);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-400 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span><span className="font-bold text-white">{inventory.length}</span> items</span>
            {totalWeight > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span>
                  <span className={cn('font-bold', weightColor)}>{totalWeight.toFixed(1)}</span>
                  {' / '}{carryCapacity} lb
                </span>
                {encLabel && (
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', encBadge)}>
                    {encLabel}
                  </span>
                )}
              </>
            )}
          </div>
          {totalWeight > 0 && (
            <div className="mt-1.5 h-1 rounded-full bg-slate-700 overflow-hidden max-w-xs">
              <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${encPct * 100}%` }} />
            </div>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => { setDraftItem({ name: '', quantity: 1, category: 'gear' }); setSuggestions([]); setShowSuggestions(false); setAddOpen(true); }}>
          <Plus size={14} /> Add Item
        </Button>
      </div>

      {inventory.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p>Your bag is empty.</p>
          <p className="text-sm mt-1">Click "Add Item" to manually add gear.</p>
        </div>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const items = byCategory[cat];
          if (!items?.length) return null;
          return (
            <div key={cat} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-slate-750 border-b border-slate-700 flex items-center gap-2">
                <h3 className="font-bold text-slate-300 text-sm capitalize">{cat}</h3>
                <span className="text-xs text-slate-500">({items.length})</span>
              </div>
              <div className="divide-y divide-slate-700/50">
                {items.map(item => (
                  <HoverCard key={item.id} content={<ItemTooltip item={item} />}>
                    <InventoryRow
                      item={item}
                      onRemove={() => removeInventoryItem(item.id)}
                      onQtyChange={qty => setInventoryQuantity(item.id, qty)}
                      onToggleEquipped={() => toggleInventoryEquipped(item.id)}
                      onRename={name => renameInventoryItem(item.id, name)}
                      onDescriptionChange={desc => setInventoryDescription(item.id, desc)}
                      onChargesChange={charges => setItemCharges(item.id, charges)}
                    />
                  </HoverCard>
                ))}
              </div>
            </div>
          );
        })
      )}

      <CurrencyPanel character={character} updateCurrency={updateCurrency} addInventoryItem={addInventoryItem} />

      <Dialog open={addOpen} onClose={() => { setAddOpen(false); setShowSuggestions(false); }} title="Add Item">
        <div className="space-y-3">
          <div className="relative">
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <input
              type="text"
              autoFocus
              value={draftItem.name}
              onChange={e => handleNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { setShowSuggestions(false); handleAdd(); }
                if (e.key === 'Escape') setShowSuggestions(false);
              }}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-red-500"
              placeholder="Longsword, Healing potion, Rope..."
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                {suggestions.map(item => (
                  <button
                    key={item.name}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectSuggestion(item); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-700 transition-colors"
                  >
                    <span className={cn('text-[10px] uppercase border rounded px-1.5 py-0.5 shrink-0', CATEGORY_BADGE[item.category])}>
                      {item.category}
                    </span>
                    <span className="text-sm text-white truncate">{item.name}</span>
                    {item.weight != null && item.weight > 0 && (
                      <span className="text-xs text-slate-500 ml-auto shrink-0">{item.weight} lb</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                value={draftItem.quantity}
                onChange={e => setDraftItem({ ...draftItem, quantity: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-red-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <select
                value={draftItem.category}
                onChange={e => setDraftItem({ ...draftItem, category: e.target.value as ItemCategory })}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-red-500"
              >
                {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Weight (lb, optional)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={draftItem.weight ?? ''}
                onChange={e => setDraftItem({ ...draftItem, weight: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Charges (optional)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={draftItem.maxCharges ?? ''}
                onChange={e => setDraftItem({ ...draftItem, maxCharges: e.target.value === '' ? undefined : Math.max(1, parseInt(e.target.value) || 1) })}
                placeholder="e.g. 3"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-red-500 placeholder-slate-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {draftItem.category === 'pack' ? 'Contents (shown in tooltip)' : 'Description (shown in tooltip, optional)'}
            </label>
            <textarea
              rows={3}
              value={draftItem.description ?? ''}
              onChange={e => setDraftItem({ ...draftItem, description: e.target.value || undefined })}
              placeholder={draftItem.category === 'pack' ? 'Bedroll, 10 torches, 10 days rations…' : 'Notes about this item…'}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-red-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!draftItem.name.trim()}>Add</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ChargeCounter({ charges, maxCharges, onChange }: { charges: number; maxCharges: number; onChange: (c: number) => void }) {
  const usePips = maxCharges <= 10;
  return (
    <div className="flex items-center gap-1.5 mt-1">
      {usePips ? (
        <div className="flex gap-0.5">
          {Array.from({ length: maxCharges }).map((_, i) => (
            <button
              key={i}
              onClick={() => onChange(i < charges ? charges - 1 : charges + 1)}
              title={i < charges ? 'Click to use a charge' : 'Click to restore a charge'}
              className={cn(
                'w-3 h-3 rounded-full border transition-all',
                i < charges
                  ? 'bg-pink-500 border-pink-400 hover:bg-pink-400'
                  : 'bg-slate-700 border-slate-600 hover:border-slate-400',
              )}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange(charges - 1)}
            disabled={charges <= 0}
            className="w-5 h-5 rounded bg-slate-800 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 disabled:opacity-30 transition-all flex items-center justify-center text-xs"
          >−</button>
          <span className="text-xs font-mono text-pink-300 w-10 text-center">{charges}/{maxCharges}</span>
          <button
            onClick={() => onChange(charges + 1)}
            disabled={charges >= maxCharges}
            className="w-5 h-5 rounded bg-slate-800 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 disabled:opacity-30 transition-all flex items-center justify-center text-xs"
          >+</button>
        </div>
      )}
      <button
        onClick={() => onChange(maxCharges)}
        title="Reset charges"
        className={cn(
          'transition-colors',
          charges < maxCharges ? 'text-pink-400 hover:text-pink-200' : 'text-slate-600 cursor-default',
        )}
      >
        <RotateCcw size={11} />
      </button>
      <span className="text-[10px] text-slate-500">charges</span>
    </div>
  );
}

function ItemTooltip({ item }: { item: InventoryItem }) {
  const isPack = item.category === 'pack';
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="font-bold text-white text-sm">{item.name}</p>
        <span className={cn('text-[10px] uppercase border rounded px-1.5 py-0.5', CATEGORY_BADGE[item.category])}>
          {item.category}
        </span>
        {item.quantity > 1 && (
          <span className="text-xs text-slate-400">×{item.quantity}</span>
        )}
      </div>
      {item.weight != null && item.weight > 0 && (
        <p className="text-xs text-slate-400 mb-2">
          Weight: {item.weight} lb each{item.quantity > 1 ? ` · ${(item.weight * item.quantity).toFixed(2)} lb total` : ''}
        </p>
      )}
      {item.equipped && (
        <p className="text-xs text-green-400 mb-2">Currently equipped</p>
      )}
      {isPack ? (
        <div>
          <p className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-1">Contents</p>
          {item.description ? (
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{item.description}</p>
          ) : (
            <p className="text-xs text-slate-500 italic">No contents listed — click the item name to edit, or add a description when creating.</p>
          )}
        </div>
      ) : item.description ? (
        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{item.description}</p>
      ) : (
        <p className="text-xs text-slate-500 italic">No description.</p>
      )}
      {item.source && (
        <p className="text-[10px] text-slate-600 mt-2 uppercase tracking-wide">Source: {item.source}</p>
      )}
    </div>
  );
}

interface InventoryRowProps {
  item: InventoryItem;
  onRemove: () => void;
  onQtyChange: (q: number) => void;
  onToggleEquipped: () => void;
  onRename: (n: string) => void;
  onDescriptionChange: (d: string | undefined) => void;
  onChargesChange: (c: number) => void;
}

function InventoryRow({ item, onRemove, onQtyChange, onToggleEquipped, onRename, onDescriptionChange, onChargesChange }: InventoryRowProps) {
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(item.name);
  const [editingDesc, setEditingDesc] = React.useState(false);
  const [descDraft, setDescDraft] = React.useState(item.description ?? '');

  React.useEffect(() => { setNameDraft(item.name); }, [item.name]);
  React.useEffect(() => { setDescDraft(item.description ?? ''); }, [item.description]);

  const equippable = item.category === 'armor' || item.category === 'shield' || item.category === 'weapon';

  return (
    <div className="px-4 py-2 hover:bg-slate-750 group">
      <div className="flex items-center gap-3">
        {/* Equipped toggle for weapons/armor/shields */}
        {equippable && (
          <button
            onClick={onToggleEquipped}
            className={cn(
              'w-7 h-7 rounded shrink-0 flex items-center justify-center transition-all',
              item.equipped
                ? 'bg-green-900/40 text-green-300 border border-green-700/50'
                : 'bg-slate-900 text-slate-500 border border-slate-700 hover:text-slate-300',
            )}
            title={item.equipped ? 'Equipped' : 'Equip'}
          >
            {item.category === 'shield' ? <Shield size={14} /> : <Sword size={14} />}
          </button>
        )}

        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={() => { if (nameDraft.trim() && nameDraft !== item.name) onRename(nameDraft.trim()); setEditingName(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.currentTarget.blur(); }
                if (e.key === 'Escape') { setNameDraft(item.name); setEditingName(false); }
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-white text-sm focus:outline-none focus:border-red-500"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="text-sm font-medium text-white hover:text-red-300 transition-colors text-left truncate"
              title="Click to rename"
            >
              {item.name}
            </button>
          )}
          {item.weight != null && item.weight > 0 && (
            <p className="text-xs text-slate-500">{(item.weight * item.quantity).toFixed(2)} lb</p>
          )}
          {item.maxCharges != null && (
            <ChargeCounter
              charges={item.charges ?? item.maxCharges}
              maxCharges={item.maxCharges}
              onChange={onChargesChange}
            />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onQtyChange(item.quantity - 1)}
            className="w-6 h-6 rounded bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-all flex items-center justify-center"
            title="Decrease"
          >−</button>
          <span className="w-8 text-center text-sm text-white font-bold">{item.quantity}</span>
          <button
            onClick={() => onQtyChange(item.quantity + 1)}
            className="w-6 h-6 rounded bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-all flex items-center justify-center"
            title="Increase"
          >+</button>
        </div>

        <button
          onClick={() => { setDescDraft(item.description ?? ''); setEditingDesc(true); }}
          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-blue-400 transition-all shrink-0"
          title="Edit description / notes"
        >
          <Pencil size={13} />
        </button>

        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all shrink-0"
          title="Remove item"
        >
          <X size={14} />
        </button>
      </div>

      {editingDesc && (
        <div className="mt-2">
          <textarea
            autoFocus
            rows={3}
            value={descDraft}
            onChange={e => setDescDraft(e.target.value)}
            onBlur={() => { onDescriptionChange(descDraft.trim() || undefined); setEditingDesc(false); }}
            onKeyDown={e => {
              if (e.key === 'Escape') { setDescDraft(item.description ?? ''); setEditingDesc(false); }
            }}
            placeholder={item.category === 'pack' ? 'Pack contents…' : 'Notes / description…'}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <p className="text-[10px] text-slate-500 mt-0.5">Blur or Esc to save</p>
        </div>
      )}
    </div>
  );
}

// ── D&D 5e currency conversion rates (in CP) ────────────────────────────────
const CP_VALUE: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number> = {
  cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000,
};
const COIN_COLORS: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', string> = {
  cp: 'text-orange-400', sp: 'text-slate-300', ep: 'text-blue-400', gp: 'text-yellow-400', pp: 'text-purple-400',
};
const COIN_BORDER_FOCUS: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', string> = {
  cp: 'focus:border-orange-500', sp: 'focus:border-slate-400', ep: 'focus:border-blue-500',
  gp: 'focus:border-yellow-500', pp: 'focus:border-purple-500',
};
type CoinKey = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';
const COINS: CoinKey[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

function CurrencyPanel({
  character,
  updateCurrency,
  addInventoryItem,
}: {
  character: Character;
  updateCurrency: (coin: CoinKey, v: number) => void;
  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => void;
}) {
  type SpendFields = Record<CoinKey, string>;
  const [spend, setSpend] = React.useState<SpendFields>({ cp: '', sp: '', ep: '', gp: '', pp: '' });
  const [spendError, setSpendError] = React.useState<string | null>(null);
  const [spendFlash, setSpendFlash] = React.useState(false);
  const [storeOpen, setStoreOpen] = React.useState(false);

  const cur = character.currencies;

  function totalHeldCP() {
    return COINS.reduce((sum, c) => sum + cur[c] * CP_VALUE[c], 0);
  }

  function spendTotalCP() {
    return COINS.reduce((sum, c) => {
      const v = parseInt(spend[c]) || 0;
      return sum + v * CP_VALUE[c];
    }, 0);
  }

  function deductCP(costCp: number): boolean {
    const withoutEP = cur.cp + cur.sp * 10 + cur.gp * 100 + cur.pp * 1000;
    const withEP    = withoutEP + cur.ep * 50;
    if (costCp > withEP) return false;

    const useEP = costCp > withoutEP;
    let remaining = (useEP ? withEP : withoutEP) - costCp;

    const hasPP = cur.pp > 0;
    const newPP = hasPP ? Math.floor(remaining / 1000) : 0;
    remaining  -= newPP * 1000;
    const newGP = Math.floor(remaining / 100);
    remaining  -= newGP * 100;
    const newSP = Math.floor(remaining / 10);
    const newCP = remaining % 10;
    const newEP = useEP ? 0 : cur.ep;

    updateCurrency('pp', newPP);
    updateCurrency('gp', newGP);
    updateCurrency('ep', newEP);
    updateCurrency('sp', newSP);
    updateCurrency('cp', newCP);
    return true;
  }

  function handleSpend() {
    const cost = spendTotalCP();
    if (cost === 0) return;
    if (!deductCP(cost)) {
      const gpEq = (totalHeldCP() / 100).toFixed(2).replace(/\.?0+$/, '');
      setSpendError(`Not enough funds (you have ~${gpEq} gp total)`);
      return;
    }
    setSpendError(null);
    setSpend({ cp: '', sp: '', ep: '', gp: '', pp: '' });
    setSpendFlash(true);
    setTimeout(() => setSpendFlash(false), 900);
  }

  const spendCP = spendTotalCP();
  const spendGPDisplay = spendCP > 0
    ? `= ${(spendCP / 100).toFixed(2).replace(/\.?0+$/, '')} gp`
    : null;

  const canAfford = spendCP > 0 && spendCP <= totalHeldCP();

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader className="mb-0">Currency</SectionHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStoreOpen(true)}
            className="text-xs text-slate-400 hover:text-emerald-300 px-2 py-1 rounded border border-slate-600 hover:border-emerald-600 transition-colors"
            title="Buy items from the town store"
          >
            🛒 Shop
          </button>
          <button
            onClick={() => {
              let { cp, sp, ep, gp, pp } = cur;
              const cpGain = Math.floor(cp / 10); cp = cp % 10; sp += cpGain;
              const spGain = Math.floor(sp / 10);  sp = sp % 10;  gp += spGain;
              const gpGain = Math.floor(gp / 10);  gp = gp % 10;  pp += gpGain;
              updateCurrency('cp', cp);
              updateCurrency('sp', sp);
              updateCurrency('ep', ep);
              updateCurrency('gp', gp);
              updateCurrency('pp', pp);
            }}
            className="text-xs text-slate-400 hover:text-yellow-300 px-2 py-1 rounded border border-slate-600 hover:border-yellow-600 transition-colors"
            title="Convert up: 10cp→1sp, 10sp→1gp, 10gp→1pp"
          >
            ⬆ Convert
          </button>
        </div>
      </div>

      <TownStoreDialog
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        totalHeldCP={totalHeldCP()}
        deductCP={deductCP}
        addInventoryItem={addInventoryItem}
      />

      <div className={cn('grid grid-cols-5 gap-2 transition-all duration-300', spendFlash && 'opacity-60 scale-[0.99]')}>
        {COINS.map(coin => (
          <div key={coin} className="text-center">
            <label className={cn('text-xs uppercase font-bold block mb-1', COIN_COLORS[coin])}>{coin}</label>
            <input
              type="number"
              min={0}
              value={cur[coin]}
              onChange={e => {
                const v = Math.floor(Number(e.target.value));
                if (!isNaN(v)) updateCurrency(coin, v);
              }}
              className={cn(
                'w-full bg-slate-900 border border-slate-600 rounded px-1 py-1 text-white text-sm text-center focus:outline-none',
                COIN_BORDER_FOCUS[coin],
                spendFlash && 'border-green-500',
              )}
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-2 mb-4">
        10 cp = 1 sp · 10 sp = 1 gp · 10 gp = 1 pp · 1 ep = 5 sp
      </p>

      <div className="border-t border-slate-700 pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Spend</p>
          {spendGPDisplay && (
            <span className={cn('text-xs font-medium', canAfford ? 'text-slate-400' : 'text-red-400')}>
              {spendGPDisplay}
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2 mb-2">
          {COINS.map(coin => (
            <div key={coin} className="text-center">
              <label className={cn('text-xs uppercase font-bold block mb-1', COIN_COLORS[coin])}>{coin}</label>
              <input
                type="number"
                min={0}
                value={spend[coin]}
                placeholder="0"
                onChange={e => {
                  const raw = e.target.value;
                  setSpend(prev => ({ ...prev, [coin]: raw }));
                  setSpendError(null);
                }}
                onKeyDown={e => e.key === 'Enter' && handleSpend()}
                className={cn(
                  'w-full bg-slate-900 border rounded px-1 py-1 text-white text-sm text-center focus:outline-none placeholder-slate-600',
                  spendError ? 'border-red-700 focus:border-red-500' : 'border-slate-600',
                  COIN_BORDER_FOCUS[coin],
                )}
              />
            </div>
          ))}
        </div>

        {spendError && (
          <p className="text-xs text-red-400 mb-2">⚠ {spendError}</p>
        )}

        <button
          onClick={handleSpend}
          disabled={spendCP === 0}
          className={cn(
            'w-full py-1.5 rounded-lg text-sm font-semibold border transition-all',
            spendCP === 0
              ? 'bg-slate-800 border-slate-700 text-slate-600 cursor-not-allowed'
              : canAfford
                ? 'bg-red-950/40 border-red-700/60 text-red-300 hover:bg-red-900/50 hover:border-red-500 hover:text-red-200'
                : 'bg-red-950/20 border-red-900/50 text-red-500 cursor-not-allowed',
          )}
        >
          {spendCP === 0 ? 'Enter an amount to spend' : canAfford ? '💸 Spend & Make Change' : '⚠ Not enough funds'}
        </button>
      </div>
    </div>
  );
}

function TownStoreDialog({
  open,
  onClose,
  totalHeldCP,
  deductCP,
  addInventoryItem,
}: {
  open: boolean;
  onClose: () => void;
  totalHeldCP: number;
  deductCP: (costCp: number) => boolean;
  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => void;
}) {
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [flashKey, setFlashKey] = React.useState<string | null>(null);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);

  function getQty(key: string) { return quantities[key] ?? 1; }
  function setQty(key: string, v: number) {
    setQuantities(prev => ({ ...prev, [key]: Math.max(1, v) }));
  }

  function handleBuy(sectionIdx: number, itemIdx: number) {
    const key = `${sectionIdx}-${itemIdx}`;
    const item = TOWN_STORE[sectionIdx].items[itemIdx];
    const qty = getQty(key);
    const totalCost = item.priceCp * qty;

    if (!deductCP(totalCost)) {
      setErrorKey(key);
      setTimeout(() => setErrorKey(null), 1200);
      return;
    }

    const stackQty = (item.qty ?? 1) * qty;
    addInventoryItem({
      name: item.name,
      quantity: stackQty,
      category: item.category,
      weight: item.weight,
      description: item.description,
      source: 'manual',
    });

    setFlashKey(key);
    setTimeout(() => setFlashKey(null), 800);
  }

  const walletGP = (totalHeldCP / 100).toFixed(2).replace(/\.?0+$/, '');

  return (
    <Dialog open={open} onClose={onClose} title="Town Store" wide>
      <p className="text-xs text-slate-400 mb-4">
        Wallet: <span className="text-yellow-300 font-bold">{walletGP} gp</span> equivalent
      </p>
      <div className="space-y-6">
        {TOWN_STORE.map((section, sIdx) => (
          <div key={section.label}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 border-b border-slate-700 pb-1">
              {section.label}
            </h3>
            <div className="space-y-1.5">
              {section.items.map((item, iIdx) => {
                const key = `${sIdx}-${iIdx}`;
                const qty = getQty(key);
                const totalCost = item.priceCp * qty;
                const canAfford = totalCost <= totalHeldCP;
                const isFlash = flashKey === key;
                const isError = errorKey === key;
                return (
                  <div
                    key={item.name}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 transition-all duration-300',
                      isFlash ? 'bg-emerald-900/30 border border-emerald-700/40' :
                      isError ? 'bg-red-950/40 border border-red-800/40' :
                      'bg-slate-900 border border-transparent'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{item.name}</p>
                      {item.description && (
                        <p className="text-[10px] text-slate-500 leading-tight line-clamp-1">{item.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-yellow-400 font-bold shrink-0 w-16 text-right">
                      {qty > 1 ? `${(totalCost / 100).toFixed(2).replace(/\.?0+$/, '')} gp` : item.priceLabel}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setQty(key, qty - 1)}
                        className="w-5 h-5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs leading-none flex items-center justify-center"
                      >−</button>
                      <span className="w-5 text-center text-xs text-white">{qty}</span>
                      <button
                        onClick={() => setQty(key, qty + 1)}
                        className="w-5 h-5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs leading-none flex items-center justify-center"
                      >+</button>
                    </div>
                    <button
                      onClick={() => handleBuy(sIdx, iIdx)}
                      disabled={!canAfford}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded border font-semibold transition-all shrink-0',
                        canAfford
                          ? 'bg-emerald-900/30 border-emerald-700/50 text-emerald-300 hover:bg-emerald-800/40 hover:border-emerald-500'
                          : 'bg-slate-800 border-slate-700 text-slate-600 cursor-not-allowed'
                      )}
                    >
                      Buy
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
