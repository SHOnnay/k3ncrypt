import React from 'react';
import { useTheme, ThemeName } from '../../theme/ThemeContext';
import { CheckIcon, MoonIcon, SunIcon } from './icons';
import './ThemeSwitcher.css';

const options: Array<{ id: ThemeName; name: string; description: string }> = [
  { id: 'paper', name: 'Paper & Ink', description: 'Warm, personal, and bright' },
  { id: 'slate', name: 'Slate Dusk', description: 'Quiet, focused, and low light' },
];

export const ThemeSwitcher: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Choose appearance">
      {options.map((option) => {
        const selected = option.id === theme;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`theme-option theme-option--${option.id} ${selected ? 'selected' : ''}`}
            onClick={() => setTheme(option.id)}
          >
            <span className="theme-preview" aria-hidden="true"><i /><i /><i /></span>
            <span className="theme-option__copy">
              <span>{option.id === 'paper' ? <SunIcon size={17} /> : <MoonIcon size={17} />}{option.name}</span>
              <small>{option.description}</small>
            </span>
            <span className="theme-check" aria-hidden="true">{selected && <CheckIcon size={15} />}</span>
          </button>
        );
      })}
    </div>
  );
};
