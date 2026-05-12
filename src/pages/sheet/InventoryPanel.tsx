import React from 'react';
import { Plus, X, Shield, Sword } from 'lucide-react';
import { Button, Dialog } from '../../components/ui';
import { cn } from '../../utils/cn';
import type { Character, InventoryItem, ItemCategory } from '../../types';

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
  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => void;
  removeInventoryItem: (id: string) => void;
  setInventoryQuantity: (id: string, qty: number) => void;
  toggleInventoryEquipped: (id: string) => void;
  renameInventoryItem: (id: string, name: string) => void;
}

export function InventoryPanel({
  character,
  addInventoryItem,
  removeInventoryItem,
  setInventoryQuantity,
  toggleInventoryEquipped,
  renameInventoryItem,
}: InventoryPanelProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [draftItem, setDraftItem] = React.useState<{
    name: string; quantity: number; category: ItemCategory; weight?: number; description?: string;
  }>({ name: '', quantity: 1, category: 'gear' });

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

  function handleAdd() {
    if (!draftItem.name.trim()) return;
    addInventoryItem({
      name: draftItem.name.trim(),
      quantity: Math.max(1, draftItem.quantity),
      category: draftItem.category,
      weight: draftItem.weight,
      description: draftItem.description,
    });
    setDraftItem({ name: '', quantity: 1, category: 'gear' });
    setAddOpen(false);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-400">
          <span className="font-bold text-white">{inventory.length}</span> items
          {totalWeight > 0 && (
            <> · <span className="font-bold text-white">{totalWeight.toFixed(1)}</span> lb</>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
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
                  <InventoryRow
                    key={item.id}
                    item={item}
                    onRemove={() => removeInventoryItem(item.id)}
                    onQtyChange={qty => setInventoryQuantity(item.id, qty)}
                    onToggleEquipped={() => toggleInventoryEquipped(item.id)}
                    onRename={name => renameInventoryItem(item.id, name)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Item">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <input
              type="text"
              autoFocus
              value={draftItem.name}
              onChange={e => setDraftItem({ ...draftItem, name: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-red-500"
              placeholder="Longsword, Healing potion, Rope..."
            />
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
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!draftItem.name.trim()}>Add</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

interface InventoryRowProps {
  item: InventoryItem;
  onRemove: () => void;
  onQtyChange: (q: number) => void;
  onToggleEquipped: () => void;
  onRename: (n: string) => void;
}

function InventoryRow({ item, onRemove, onQtyChange, onToggleEquipped, onRename }: InventoryRowProps) {
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(item.name);

  React.useEffect(() => { setNameDraft(item.name); }, [item.name]);

  const equippable = item.category === 'armor' || item.category === 'shield' || item.category === 'weapon';

  return (
    <div className="px-4 py-2 flex items-center gap-3 hover:bg-slate-750 group">
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
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all shrink-0"
        title="Remove item"
      >
        <X size={14} />
      </button>
    </div>
  );
}
