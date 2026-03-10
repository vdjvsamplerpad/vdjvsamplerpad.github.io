import * as React from 'react';
import { VERSION_OPTIONS, VersionKey } from '@/components/landing/download-config';

type VersionSelectorProps = {
  value: VersionKey;
  onChange: (next: VersionKey) => void;
};

export function VersionSelector({ value, onChange }: VersionSelectorProps) {
  const activeIndex = Math.max(0, VERSION_OPTIONS.indexOf(value));
  const sliderStyle = { ['--lp-version-index' as string]: activeIndex } as React.CSSProperties;

  return (
    <div role="radiogroup" aria-label="Select version">
      <div className="lp-version-label">Version</div>
      <div className="lp-version-options" style={sliderStyle}>
        <span className="lp-version-liquid" aria-hidden="true" />
        {VERSION_OPTIONS.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              className={`lp-version-option ${active ? 'is-active' : ''}`}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
