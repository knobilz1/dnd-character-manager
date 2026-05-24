import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLibraryStore } from '../store/useLibraryStore';
import { ThemeToggleButton } from '../components/ui';
import { useThemeStore } from '../store/useThemeStore';

function Tombstone({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 120 160" width="120" height="160" xmlns="http://www.w3.org/2000/svg">
      {/* Stone base */}
      <rect x="10" y="130" width="100" height="20" rx="3" fill="#374151" stroke="#4b5563" strokeWidth="1.5" />
      {/* Stone body */}
      <rect x="20" y="60" width="80" height="78" rx="4" fill="#374151" stroke="#4b5563" strokeWidth="1.5" />
      {/* Rounded arch top */}
      <path d="M20,70 Q20,20 60,20 Q100,20 100,70" fill="#374151" stroke="#4b5563" strokeWidth="1.5" />
      {/* RIP text */}
      <text x="60" y="58" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#9ca3af" fontFamily="Georgia, serif" letterSpacing="2">R.I.P.</text>
      {/* Dividing line */}
      <line x1="35" y1="65" x2="85" y2="65" stroke="#4b5563" strokeWidth="1" />
      {/* Character name — wrap at ~10 chars per line */}
      <foreignObject x="24" y="68" width="72" height="62">
        <div
          style={{
            width: '72px',
            height: '62px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: '#d1d5db',
            fontSize: '11px',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            lineHeight: '1.3',
            wordBreak: 'break-word',
            overflow: 'hidden',
          }}
        >
          {name}
        </div>
      </foreignObject>
    </svg>
  );
}

export function GraveyardPage() {
  const navigate = useNavigate();
  const { characters } = useLibraryStore();
  const { theme, toggleTheme } = useThemeStore();

  const buried = characters.filter(c => c.inGraveyard);

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-slate-300 flex items-center gap-3">
                ⚰ Graveyard
              </h1>
              <p className="text-slate-500 mt-1">The fallen — those who did not survive</p>
            </div>
          </div>
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
        </div>

        {buried.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-6 opacity-30">⚰</div>
            <h2 className="text-2xl font-bold text-slate-500 mb-2">Empty graveyard</h2>
            <p className="text-slate-600">Your characters are all still alive</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {buried.map(character => (
              <button
                key={character.id}
                onClick={() => navigate(`/character/${character.id}`)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-700 hover:border-slate-500 bg-slate-800/60 hover:bg-slate-800 transition-all group cursor-pointer"
              >
                <div className="opacity-75 group-hover:opacity-100 transition-opacity">
                  <Tombstone name={character.name || 'Unnamed'} />
                </div>
                <p className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors text-center font-medium">
                  {character.name || 'Unnamed'}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
