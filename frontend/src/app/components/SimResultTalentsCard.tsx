'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import TalentTree from './TalentTree';
import { decodeHeader } from '../lib/talentDecode';
import { SPEC_ID_TO_NAME, specDisplayName } from '../lib/types';

interface SimResultTalentsCardProps {
  talentString: string;
}

export default function SimResultTalentsCard({ talentString }: SimResultTalentsCardProps) {
  const specLabel = useMemo(() => {
    try {
      const specId = decodeHeader(talentString).specId;
      const specName = SPEC_ID_TO_NAME[specId];
      return specName ? specDisplayName(specName) : null;
    } catch {
      return null;
    }
  }, [talentString]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.01] p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            {specLabel ? (
              <>
                Specialization: <span className="text-gold">{specLabel}</span>
              </>
            ) : (
              'Talents'
            )}
          </h3>
          <Link
            href={`/talent-playground?talent=${encodeURIComponent(talentString)}&name=${encodeURIComponent(specLabel ? `${specLabel} Result` : 'Sim Result')}`}
            className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            Playground
          </Link>
        </div>
      </div>
      <div className="bg-black/20 p-2">
        <TalentTree talentString={talentString} bare />
      </div>
    </div>
  );
}
