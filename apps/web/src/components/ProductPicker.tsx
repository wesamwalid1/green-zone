import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { Input } from './ui';

export type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  hint?: string;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function ProductPicker({
  products,
  value,
  disabled,
  placeholder = 'اكتب اسم الصنف',
  invalid,
  lineIndex,
  onChange,
  onEnter,
}: {
  products: PickerProduct[];
  value: string;
  disabled?: boolean;
  placeholder?: string;
  invalid?: boolean;
  /** لتركيز بند معيّن بعد Enter */
  lineIndex?: number;
  onChange: (productId: string) => void;
  /** بعد اختيار صنف بـ Enter (أو Enter والصنف متحدد) */
  onEnter?: (productId: string) => void;
}) {
  const selected = products.find((product) => product.id === value);
  const [text, setText] = useState(selected?.name || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(selected?.name || '');
  }, [value, selected?.name]);

  const matches = useMemo(() => {
    const query = normalize(text);
    const ranked = products
      .map((product) => {
        const name = normalize(product.name);
        const sku = normalize(product.sku);
        const barcode = normalize(product.barcode || '');
        if (!query) return { product, hit: true, rank: 2 };
        const hit = name.includes(query) || sku.includes(query) || barcode.includes(query);
        const rank = name === query || sku === query || barcode === query ? 0 : name.startsWith(query) || sku.startsWith(query) ? 1 : 2;
        return { product, hit, rank };
      })
      .filter((row) => row.hit)
      .sort((a, b) => a.rank - b.rank || a.product.name.localeCompare(b.product.name, 'ar'))
      .slice(0, 8)
      .map((row) => row.product);
    return ranked;
  }, [products, text]);

  function place() {
    const node = wrapRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, text, matches.length]);

  function choose(product: PickerProduct) {
    onChange(product.id);
    setText(product.name);
    setOpen(false);
  }

  function exactMatch() {
    const query = normalize(text);
    return products.find((product) => normalize(product.name) === query || normalize(product.sku) === query || normalize(product.barcode || '') === query);
  }

  function commitFromEnter() {
    if (value && selected && normalize(text) === normalize(selected.name)) {
      if (open && matches[active] && matches[active].id !== value) {
        choose(matches[active]);
        onEnter?.(matches[active].id);
        return;
      }
      setOpen(false);
      onEnter?.(value);
      return;
    }
    const exact = exactMatch();
    const picked = exact || matches[active] || (matches.length === 1 ? matches[0] : undefined);
    if (!picked) return;
    choose(picked);
    onEnter?.(picked.id);
  }

  const extraInput: InputHTMLAttributes<HTMLInputElement> = lineIndex == null
    ? {}
    : { 'data-product-line': String(lineIndex) } as InputHTMLAttributes<HTMLInputElement>;

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        {...extraInput}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        className={invalid ? 'border-rose-300' : ''}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          const exact = exactMatch();
          if (exact) {
            choose(exact);
            return;
          }
          window.setTimeout(() => {
            setOpen(false);
            if (selected && text.trim() === selected.name) return;
            onChange('');
            setText('');
          }, 150);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActive(0);
            } else {
              setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commitFromEnter();
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && box && (
        <ul
          className="fixed z-[90] max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          style={{ top: box.top, left: box.left, width: box.width }}
        >
          {matches.map((product, index) => (
            <li key={product.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-right ${index === active ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50'}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(product);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{product.name}</span>
                  <span className="block truncate font-mono text-[11px] text-slate-400" dir="ltr">{product.sku}</span>
                </span>
                {product.hint && <span className="shrink-0 text-xs font-semibold text-slate-500">{product.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
