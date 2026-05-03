'use client';

import { useRef, useState, type UIEvent } from 'react';

type SimcInputEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

function renderSimcLine(line: string) {
  if (!line) return null;

  if (/^\s*#\s*Checksum:/i.test(line)) {
    return <span className="text-amber-300">{line}</span>;
  }
  if (/^\s*#/.test(line)) {
    return <span className="text-zinc-500">{line}</span>;
  }

  const kv = line.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/);
  if (!kv) return <span className="text-zinc-300">{line}</span>;

  const [, indent, key, sep, rawValue] = kv;
  const valueClass =
    /^".*"$/.test(rawValue) || /^[A-Za-z_/-]+$/.test(rawValue)
      ? 'text-emerald-300'
      : /^\d+(?:\.\d+)?$/.test(rawValue)
        ? 'text-sky-300'
        : 'text-zinc-300';

  return (
    <>
      <span className="text-zinc-300">{indent}</span>
      <span className="text-gold">{key}</span>
      <span className="text-zinc-500">{sep}</span>
      <span className={valueClass}>{rawValue}</span>
    </>
  );
}

export default function SimcInputEditor({ value, onChange, placeholder }: SimcInputEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const editorHeight = expanded ? 'h-[28rem]' : 'h-40';

  const syncScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return;
    preRef.current.scrollTop = e.currentTarget.scrollTop;
    preRef.current.scrollLeft = e.currentTarget.scrollLeft;
  };

  const lines = value.split('\n');

  // Keep text metrics aligned between pre and textarea so colorized text matches cursor positions.
  const typographyClasses = 'font-mono text-[13px] leading-[1.6] whitespace-pre px-4 py-3';

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="relative w-full rounded-lg border border-border bg-surface-2 shadow-sm transition-all duration-150 focus-within:border-gold/50 focus-within:ring-2 focus-within:ring-gold/20">
        <pre
          ref={preRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 ${editorHeight} scrollbar-none w-full overflow-hidden ${typographyClasses}`}
        >
          {value ? (
            lines.map((line, idx) => (
              <span key={idx}>
                {renderSimcLine(line)}
                {idx < lines.length - 1 ? '\n' : null}
              </span>
            ))
          ) : (
            <span className="text-zinc-500 opacity-0">{placeholder}</span>
          )}
        </pre>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          placeholder={placeholder}
          spellCheck={false}
          className={`relative block ${editorHeight} w-full resize-none overflow-auto bg-transparent text-transparent placeholder-zinc-500 caret-zinc-100 focus:outline-none ${typographyClasses}`}
        />
      </div>
    </div>
  );
}
