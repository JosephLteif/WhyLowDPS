export type CharacterPageTab = 'profile' | 'raiding' | 'mythic' | 'vault';

type CharacterPageTabsProps = {
  value: CharacterPageTab;
  onChange: (tab: CharacterPageTab) => void;
};

const TABS: Array<{ key: CharacterPageTab; label: string }> = [
  { key: 'profile', label: 'Profile' },
  { key: 'raiding', label: 'Raiding' },
  { key: 'mythic', label: 'Mythic+' },
  { key: 'vault', label: 'Vault' },
];

export default function CharacterPageTabs({ value, onChange }: CharacterPageTabsProps) {
  return (
    <div className="card p-2">
      <div className="grid grid-cols-4 gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-md px-2 py-2 text-xs font-bold ${
              value === tab.key ? 'bg-gold/20 text-gold' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
