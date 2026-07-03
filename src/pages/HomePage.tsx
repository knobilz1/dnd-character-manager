import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ChevronRight, Sword, Shield, Download, Upload, RefreshCw, Printer, Radio, Send, Wand2 } from 'lucide-react';
import { DriveSyncButton } from '../components/DriveSync';
import { getVersion } from '@tauri-apps/api/app';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { printCharacterToPDF, pickAndStoreTemplatePath, clearCustomTemplatePath, getCustomTemplatePath } from '../utils/pdfTemplate';
import { useLibraryStore } from '../store/useLibraryStore';
import { Button, Dialog, ThemeToggleButton } from '../components/ui';
import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { totalCharacterLevel } from '../data/mechanics';
import type { Character } from '../types';
import type { UpdateCheckStatus } from '../hooks/useAppUpdater';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useThemeStore } from '../store/useThemeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { sendCharacterToDM, sendAllToDM } from '../utils/dmConnect';

async function exportCharacter(character: Character) {
  const snapshots = useSnapshotStore.getState().snapshotsFor(character.id);
  const payload = { tavernSheet: true, version: 1, character, snapshots };
  const json = JSON.stringify(payload, null, 2);
  const path = await save({
    defaultPath: `${character.name || 'character'}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (path) await writeTextFile(path, json);
}

export function HomePage({ checkForUpdates, checkStatus }: { checkForUpdates?: () => void; checkStatus?: UpdateCheckStatus }) {
  const navigate = useNavigate();
  const { characters: allCharacters, deleteCharacter, createCharacter } = useLibraryStore();
  const characters = allCharacters.filter(c => !c.inGraveyard);
  const graveyardCount = allCharacters.filter(c => c.inGraveyard).length;
  const { theme, toggleTheme } = useThemeStore();
  const { show3DCharacter, setShow3DCharacter } = useSettingsStore();
  const { dmIp, setDmIp } = useSettingsStore();
  const [dmOpen, setDmOpen] = React.useState(false);
  const [dmStatus, setDmStatus] = React.useState<string | null>(null);
  const [dmSending, setDmSending] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const [appVersion, setAppVersion] = React.useState<string | null>(null);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [printSelected, setPrintSelected] = React.useState<Set<string>>(new Set());
  const [printing, setPrinting] = React.useState(false);

  React.useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  function handleOpen(id: string) {
    navigate(`/character/${id}`);
  }

  function handleCreate() {
    navigate('/create');
  }

  function confirmDelete() {
    if (deleteId) deleteCharacter(deleteId);
    setDeleteId(null);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);

        // Support both new envelope format and legacy plain-character files
        const isEnvelope = parsed?.tavernSheet === true && parsed?.character;
        const data: Character = isEnvelope ? parsed.character : parsed;

        if (!data.name || !data.classes || !data.baseAbilityScores) {
          setImportError('Invalid character file — missing required fields.');
          return;
        }

        const newId = crypto.randomUUID();
        const imported: Character = { ...data, id: newId, updatedAt: Date.now() };
        createCharacter(imported);

        // Restore snapshot history if present
        if (isEnvelope && Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0) {
          useSnapshotStore.getState().importSnapshots(newId, parsed.snapshots);
        }

        navigate(`/character/${newId}`);
      } catch {
        setImportError('Could not read file. Make sure it\'s a valid Tavern Sheet JSON export.');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported if needed
    e.target.value = '';
  }

  function openPrintModal() {
    // Pre-select all characters when opening the modal
    setPrintSelected(new Set(characters.map(c => c.id)));
    setPrintOpen(true);
  }

  function togglePrintChar(id: string) {
    setPrintSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function togglePrintAll() {
    if (printSelected.size === characters.length) {
      setPrintSelected(new Set());
    } else {
      setPrintSelected(new Set(characters.map(c => c.id)));
    }
  }

  async function handlePrint() {
    const selected = characters.filter(c => printSelected.has(c.id));
    if (selected.length === 0) return;
    setPrinting(true);
    try {
      if (selected.length === 1) {
        const filled = await printCharacterToPDF(selected[0]);
        const outPath = await save({
          defaultPath: `${selected[0].name}-sheet.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (outPath) { await writeFile(outPath, filled); await openPath(outPath); setPrintOpen(false); }
      } else {
        for (const char of selected) {
          const filled = await printCharacterToPDF(char);
          const outPath = await save({
            defaultPath: `${char.name}-sheet.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          });
          if (outPath) { await writeFile(outPath, filled); await openPath(outPath); }
        }
        setPrintOpen(false);
      }
    } catch (err) {
      console.error('Print failed:', err);
      const msg = err instanceof Error ? err.message
        : typeof err === 'string' ? err
        : JSON.stringify(err) || 'Unknown error';
      alert(`Print failed: ${msg}`);
    } finally {
      setPrinting(false);
    }
  }

  // Send a single character to the DM bot. Opens the connection dialog first if
  // no DM address is set yet.
  async function handleSendToDM(character: Character) {
    if (!dmIp.trim()) { setDmStatus(null); setDmOpen(true); return; }
    setDmSending(true);
    setDmStatus(`Sending ${character.name || 'character'}…`);
    try {
      await sendCharacterToDM(character, dmIp);
      setDmStatus(`✅ Sent ${character.name || 'character'} to the DM.`);
    } catch (err) {
      setDmStatus(`❌ Couldn't reach the DM at ${dmIp}. ${err instanceof Error ? err.message : ''}`);
      setDmOpen(true);
    } finally {
      setDmSending(false);
    }
  }

  async function handleSendAllToDM() {
    if (!dmIp.trim()) { setDmStatus('Enter the DM\'s address first.'); return; }
    setDmSending(true);
    setDmStatus(`Sending ${characters.length} character(s)…`);
    const { ok, failed } = await sendAllToDM(characters, dmIp);
    setDmSending(false);
    setDmStatus(failed.length
      ? `Sent ${ok}. Failed: ${failed.join(', ')}. Check the DM's address and that the bot is running.`
      : `✅ Sent all ${ok} character(s) to the DM.`);
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Sword className="text-red-500" size={32} />
              Tavern Sheet
            </h1>
            <p className="text-slate-400 mt-1">Unofficial 5e character manager · fan project</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShow3DCharacter(!show3DCharacter)}
              title={show3DCharacter ? 'Disable 3D character' : 'Enable 3D character'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
                show3DCharacter
                  ? 'bg-red-900/40 border-red-700 text-red-300 hover:bg-red-900/60'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              <span>🧍</span>
              <span className="text-xs font-medium">3D</span>
            </button>
            <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
            <button
              onClick={() => navigate('/dm')}
              title="DM Console — run the game tonight"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border bg-purple-900/40 border-purple-700 text-purple-300 hover:bg-purple-900/60 transition-colors"
            >
              <Wand2 size={16} />
              <span className="text-xs font-medium">DM Console</span>
            </button>
            <button
              onClick={() => { setDmStatus(null); setDmOpen(true); }}
              title="Send to DM (game night)"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
                dmIp
                  ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300 hover:bg-emerald-900/60'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              <Radio size={16} />
              <span className="text-xs font-medium">DM</span>
            </button>
            <DriveSyncButton />
            {graveyardCount > 0 && (
              <button
                onClick={() => navigate('/graveyard')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 transition-colors"
                title="Graveyard"
              >
                ⚰ <span className="text-xs text-slate-500">{graveyardCount}</span>
              </button>
            )}
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            {characters.length > 0 && (
              <Button variant="outline" size="lg" onClick={openPrintModal} title="Print character sheets">
                <Printer size={18} />
                Print
              </Button>
            )}
            <Button variant="outline" size="lg" onClick={() => importRef.current?.click()}>
              <Upload size={18} />
              Import
            </Button>
            <Button onClick={handleCreate} size="lg">
              <Plus size={20} />
              New Character
            </Button>
          </div>
        </div>

        {/* Character list */}
        {characters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Shield size={64} className="text-slate-700 mb-6" />
            <h2 className="text-2xl font-bold text-slate-400 mb-2">No characters yet</h2>
            <p className="text-slate-500 mb-8">Create your first character to begin your adventure</p>
            <Button onClick={handleCreate} size="lg">
              <Plus size={20} />
              Create Character
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map(character => {
              const level = totalCharacterLevel(character.classes);
              const primaryClass = character.classes[0];
              const classDef = primaryClass ? getClass(primaryClass.classId) : null;
              const race = getRace(character.raceId);
              const hpPercent = Math.round((character.currentHP / character.maxHP) * 100);

              return (
                <div
                  key={character.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-500 transition-all cursor-pointer group relative"
                  onClick={() => handleOpen(character.id)}
                >
                  {/* Card actions */}
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={e => { e.stopPropagation(); handleSendToDM(character); }}
                      className="text-slate-500 hover:text-emerald-400 transition-colors p-1 rounded"
                      title="Send to DM"
                    >
                      <Send size={16} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); exportCharacter(character); }}
                      className="text-slate-500 hover:text-blue-400 transition-colors p-1 rounded"
                      title="Export character"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteId(character.id); }}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded"
                      title="Delete character"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Character info */}
                  <div className="flex items-start gap-3 mb-3">
                    {/* Portrait */}
                    {character.portrait && (
                      <img
                        src={character.portrait}
                        alt="Portrait"
                        className="w-14 h-14 rounded-lg object-cover border border-slate-600 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-bold text-white truncate">{character.name || 'Unnamed'}</h3>
                        <div className="text-xl font-bold text-white shrink-0">Lv.{level}</div>
                      </div>
                      <p className="text-sm text-slate-400">
                        {race?.name ?? '?'} {classDef?.name ?? '?'}
                      </p>
                    </div>
                  </div>

                  {/* HP bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>HP</span>
                      <span>{character.currentHP}/{character.maxHP}</span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${hpPercent > 50 ? 'bg-green-500' : hpPercent > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${hpPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {character.conditions.length > 0 && (
                        <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded">
                          {character.conditions.length} condition{character.conditions.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {character.inspiration && (
                        <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded">✦ Inspired</span>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-slate-500 group-hover:text-white transition-colors" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transient DM status toast (when the dialog is closed) */}
      {dmStatus && !dmOpen && (
        <div
          onClick={() => setDmStatus(null)}
          className="fixed bottom-4 right-4 max-w-sm bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-sm text-slate-200 shadow-lg cursor-pointer z-50"
        >
          {dmStatus}
        </div>
      )}

      {/* DM connection dialog */}
      <Dialog open={dmOpen} onClose={() => setDmOpen(false)} title="Send to DM">
        <p className="text-slate-400 text-sm mb-4">
          On game night, whoever's running the DM Console tells you an address like
          <span className="text-slate-200"> 192.168.1.50</span> (shown at the top of their
          DM Console screen). Enter it once, then send your character so the DM sees your
          live stats.
        </p>
        <label className="block text-xs text-slate-400 mb-1">DM address (IP or IP:port)</label>
        <input
          type="text"
          value={dmIp}
          onChange={e => { setDmIp(e.target.value); setDmStatus(null); }}
          placeholder="192.168.1.50"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm mb-1 focus:outline-none focus:border-emerald-600"
        />
        <p className="text-[11px] text-slate-500 mb-4">Port defaults to 7777 if you don't specify one.</p>

        <div className="flex gap-2 mb-3">
          <Button onClick={handleSendAllToDM} disabled={dmSending || !dmIp.trim() || characters.length === 0}>
            <Radio size={16} />
            Send all ({characters.length})
          </Button>
          <Button variant="outline" onClick={() => setDmOpen(false)}>Done</Button>
        </div>
        {dmStatus && <p className="text-sm text-slate-300">{dmStatus}</p>}
      </Dialog>

      {/* Print picker dialog */}
      <Dialog open={printOpen} onClose={() => setPrintOpen(false)} title="Print Character Sheets">
        <p className="text-slate-400 text-sm mb-4">
          Choose which characters to print. Each character is saved as a separate PDF.
        </p>

        {/* Select all toggle */}
        <button
          onClick={togglePrintAll}
          className="text-xs text-slate-400 hover:text-slate-200 mb-3 transition-colors"
        >
          {printSelected.size === characters.length ? 'Deselect all' : 'Select all'}
        </button>

        {/* Character list */}
        <div className="flex flex-col gap-2 mb-6 max-h-80 overflow-y-auto pr-1">
          {characters.map(character => {
            const level = totalCharacterLevel(character.classes);
            const primaryClass = character.classes[0];
            const classDef = primaryClass ? getClass(primaryClass.classId) : null;
            const race = getRace(character.raceId);
            const checked = printSelected.has(character.id);

            return (
              <label
                key={character.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none ${
                  checked
                    ? 'border-red-500/50 bg-red-950/20'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePrintChar(character.id)}
                  className="accent-red-500 w-4 h-4 shrink-0"
                />
                {character.portrait && (
                  <img
                    src={character.portrait}
                    alt=""
                    className="w-9 h-9 rounded-md object-cover border border-slate-600 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm truncate">{character.name || 'Unnamed'}</div>
                  <div className="text-xs text-slate-400">
                    Lv.{level} {race?.name ?? ''} {classDef?.name ?? ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Template switcher */}
        <div className="flex items-center gap-2 mb-4 p-2 rounded-lg bg-slate-800/50 border border-slate-700">
          <span className="text-xs text-slate-400 flex-1">
            Template: <span className="text-slate-200 font-medium">
              {getCustomTemplatePath() ? '📄 Custom (WotC PDF)' : '✨ Built-in'}
            </span>
          </span>
          {getCustomTemplatePath() ? (
            <button
              onClick={() => { clearCustomTemplatePath(); }}
              className="text-xs text-slate-400 hover:text-red-400 transition-colors"
            >
              Use built-in
            </button>
          ) : (
            <button
              onClick={async () => { await pickAndStoreTemplatePath(); }}
              className="text-xs text-slate-400 hover:text-emerald-400 transition-colors"
            >
              Use custom template…
            </button>
          )}
        </div>

        <div className="flex gap-3 justify-end items-center">
          <span className="text-xs text-slate-500 mr-auto">
            {printSelected.size} of {characters.length} selected
          </span>
          <Button variant="secondary" onClick={() => setPrintOpen(false)} disabled={printing}>
            Cancel
          </Button>
          <Button
            onClick={handlePrint}
            disabled={printSelected.size === 0 || printing}
          >
            <Printer size={16} />
            {printing ? 'Generating…' : `Print ${printSelected.size > 0 ? `(${printSelected.size})` : ''}`}
          </Button>
        </div>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Character?">
        <p className="text-slate-300 mb-6">This action cannot be undone. The character will be permanently deleted.</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete}>Delete</Button>
        </div>
      </Dialog>

      {/* Footer */}
      {checkForUpdates && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={checkForUpdates}
            disabled={checkStatus === 'checking'}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={checkStatus === 'checking' ? 'animate-spin' : ''} />
            {checkStatus === 'checking' && 'Checking for updates…'}
            {checkStatus === 'up-to-date' && 'Up to date ✓'}
            {checkStatus === 'available' && 'Update available'}
            {checkStatus === 'error' && 'Check failed — try again'}
            {(checkStatus === 'idle' || !checkStatus) && 'Check for updates'}
          </button>
        </div>
      )}

      {/* Import error dialog */}
      <Dialog open={!!importError} onClose={() => setImportError(null)} title="Import Failed">
        <p className="text-slate-300 mb-6">{importError}</p>
        <div className="flex justify-end">
          <Button onClick={() => setImportError(null)}>OK</Button>
        </div>
      </Dialog>

      {appVersion && (
        <div className="fixed bottom-3 right-4 text-xs text-slate-600 select-none pointer-events-none">
          v{appVersion}
        </div>
      )}
    </div>
  );
}
