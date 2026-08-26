'use client';

import { Check, UserRound } from 'lucide-react';
import type { SimcClipboardInfo } from '../../lib/simc-parser';
import { useActiveCharacter } from './ActiveCharacterContext';

export default function ActiveCharacterBar({
  detectedCharacter,
}: {
  detectedCharacter?: Extract<SimcClipboardInfo, { kind: 'character' }> | null;
}) {
  const { character, setCharacter } = useActiveCharacter();
  const canSetDetected = Boolean(
    detectedCharacter?.name && detectedCharacter.server && detectedCharacter.region
  );

  const setDetectedCharacter = () => {
    if (!detectedCharacter?.name || !detectedCharacter.server || !detectedCharacter.region) return;
    setCharacter({
      name: detectedCharacter.name,
      realm: detectedCharacter.server,
      region: detectedCharacter.region,
      className: detectedCharacter.className,
      spec: detectedCharacter.spec,
      level: Number(detectedCharacter.level) || undefined,
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/20 bg-gold/[0.04] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.8} />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold/80">Active character</p>
          <p className="truncate text-sm font-semibold text-zinc-100">
            {character
              ? `${character.name} · ${character.realm} · ${character.region.toUpperCase()}`
              : 'No character selected'}
          </p>
        </div>
      </div>
      {canSetDetected && (
        <button
          type="button"
          onClick={setDetectedCharacter}
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          Use imported profile
        </button>
      )}
    </div>
  );
}
