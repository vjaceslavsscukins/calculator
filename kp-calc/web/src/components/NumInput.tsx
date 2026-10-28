import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { num, parseNum } from '../format.ts';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValue: (n: number) => void;
  digits?: number;
};

/** Поле для числа: принимает запятую, не мешает набирать «5,» и не прыгает курсор. */
export function NumInput({ value, onValue, digits = 3, ...rest }: Props) {
  const show = (n: number) => (Number.isFinite(n) ? num(n, digits).replace(/ /g, '') : '');
  const [text, setText] = useState(show(value));
  const [focus, setFocus] = useState(false);

  useEffect(() => { if (!focus) setText(show(value)); }, [value, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      {...rest}
      inputMode="decimal"
      value={text}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); setText(show(value)); rest.onBlur?.(e); }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (/^\s*-?[\d\s]*([.,]\d*)?\s*$/.test(t)) {
          const n = t.trim() === '' ? 0 : parseNum(t);
          if (n !== value) onValue(n);
        }
      }}
    />
  );
}
