'use client';

import ConsumableSelect, { buildQualityMaxByFamily } from './ConsumableSelect';
import ConsumableMatrixSelector from './ConsumableMatrixSelector';
import type { OptionEntry } from '../../lib/sim-options-catalog';

type Props = {
  title: string;
  label: string;
  mode: 'single' | 'multi';
  singleValue: string;
  onSingleChange: (v: string) => void;
  multiValues: string[];
  onMultiChange: (vals: string[]) => void;
  options: OptionEntry[];
  disabled?: boolean;
};

export default function ConsumablePicker(props: Props) {
  const qualityMaxByFamily = buildQualityMaxByFamily([props.options]);
  if (props.mode === 'single') {
    return (
      <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">{props.title}</p>
        <ConsumableSelect
          label={props.label}
          value={props.singleValue}
          onChange={props.onSingleChange}
          options={props.options}
          qualityMaxByFamily={qualityMaxByFamily}
          disabled={props.disabled}
        />
      </div>
    );
  }

  return (
    <ConsumableMatrixSelector
      title={props.title}
      options={props.options}
      selected={props.multiValues}
      onChange={props.onMultiChange}
    />
  );
}
