import { useState } from 'react';
import { Check, Palette, Type } from 'lucide-react';
import {
  COLOR_CHOICES,
  MAX_FONT,
  MIN_FONT,
  ORIGINAL_COLOR,
  ORIGINAL_FONT,
  readAppearance,
  saveAppearance,
} from '../lib/appearance';
import { Button } from './ui';

export function AppearanceSettings({ onEditing }: { onEditing?: (open: boolean) => void }) {
  const saved = readAppearance();
  const [panel, setPanel] = useState<'home' | 'color' | 'font'>('home');
  const [color, setColor] = useState(saved.color);
  const [fontPx, setFontPx] = useState(saved.fontPx);
  const [draftColor, setDraftColor] = useState(saved.color);
  const [draftFont, setDraftFont] = useState(saved.fontPx);

  function open(next: 'color' | 'font') {
    setDraftColor(color);
    setDraftFont(fontPx);
    setPanel(next);
    onEditing?.(true);
  }

  function close() {
    setPanel('home');
    onEditing?.(false);
  }

  function confirmColor() {
    saveAppearance(draftColor, fontPx);
    setColor(draftColor);
  }

  function resetColor() {
    saveAppearance(ORIGINAL_COLOR, fontPx);
    setColor(ORIGINAL_COLOR);
    setDraftColor(ORIGINAL_COLOR);
  }

  function confirmFont() {
    saveAppearance(color, draftFont);
    setFontPx(draftFont);
  }

  function resetFont() {
    saveAppearance(color, ORIGINAL_FONT);
    setFontPx(ORIGINAL_FONT);
    setDraftFont(ORIGINAL_FONT);
  }

  if (panel === 'color') {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xl font-extrabold">
            <span>تغيير اللون</span>
            <Palette size={18} className="text-brand-700" />
          </div>
          <button type="button" className="text-sm font-semibold text-slate-500" onClick={close}>رجوع</button>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
          <div className="text-right">
            <div className="text-xs text-muted">اللون المختار</div>
            <div className="mt-1 flex items-center gap-2 font-bold">
              <span className="font-mono text-sm">{draftColor}</span>
              <span className="h-7 w-7 rounded-lg border border-black/10" style={{ background: draftColor }} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={resetColor}>اللون الأصلي</Button>
            <Button type="button" variant="secondary" disabled={draftColor === color} onClick={confirmColor}>تأكيد اللون</Button>
          </div>
        </div>
        <div className="mb-2 text-xs font-semibold text-muted">الألوان ({COLOR_CHOICES.length})</div>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
          {COLOR_CHOICES.map((hex) => {
            const selected = draftColor === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                onClick={() => setDraftColor(hex)}
                className={`relative aspect-square rounded-xl border border-black/10 ${selected ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}
                style={{ background: hex }}
              >
                {selected && (
                  <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-slate-900 shadow">
                    <Check size={12} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-4 text-left text-xs text-muted">المطبق الآن: <span className="font-mono font-bold text-slate-700">{color}</span></div>
      </section>
    );
  }

  if (panel === 'font') {
    const percent = Math.round((draftFont / ORIGINAL_FONT) * 100);
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xl font-extrabold">
            <span>تغيير الخط</span>
            <Type size={18} className="text-brand-700" />
          </div>
          <button type="button" className="text-sm font-semibold text-slate-500" onClick={close}>رجوع</button>
        </div>
        <div className="mb-4 rounded-2xl border border-slate-200 px-6 py-8 text-center">
          <div className="font-extrabold text-slate-800" style={{ fontSize: draftFont }}>تيست الحجم</div>
          <div className="mt-2 text-sm text-muted">معاينة على هذا الجهاز</div>
          <div className="mt-1 text-xs text-muted">الحجم الأصلي — {ORIGINAL_FONT}px</div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
          <div className="text-right">
            <div className="text-xs text-muted">الحجم المختار</div>
            <div className="text-2xl font-extrabold">{draftFont}px</div>
            <div className="text-xs text-muted">الحجم الأصلي للنظام: {ORIGINAL_FONT}px</div>
            <div className="text-xs text-muted">المطبق الآن: {fontPx}px</div>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={resetFont}>الحجم الأصلي ({ORIGINAL_FONT}px)</Button>
            <Button type="button" variant="secondary" disabled={draftFont === fontPx} onClick={confirmFont}>تأكيد الحجم</Button>
          </div>
        </div>
        <div className="mb-2 text-center text-sm font-bold">{percent}%</div>
        <div className="flex items-center gap-3" dir="ltr">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-lg font-bold text-white" onClick={() => setDraftFont((value) => Math.min(MAX_FONT, value + 1))} aria-label="تكبير">+</button>
          <input
            dir="rtl"
            className="h-2 flex-1 accent-brand-700"
            type="range"
            min={MIN_FONT}
            max={MAX_FONT}
            value={draftFont}
            onChange={(event) => setDraftFont(Number(event.target.value))}
          />
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 text-lg font-bold text-slate-600" onClick={() => setDraftFont((value) => Math.max(MIN_FONT, value - 1))} aria-label="تصغير">−</button>
        </div>
      </section>
    );
  }

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <button type="button" onClick={() => open('color')} className="relative rounded-3xl border border-slate-200 bg-white p-6 text-right shadow-sm">
        <span className="absolute left-5 top-5 grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-brand-700">
          <Palette size={18} />
        </span>
        <div className="mt-10 text-lg font-extrabold">تغيير اللون</div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span className="font-mono">{color}</span>
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        </div>
      </button>
      <button type="button" onClick={() => open('font')} className="relative rounded-3xl border border-slate-200 bg-white p-6 text-right shadow-sm">
        <span className="absolute left-5 top-5 grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-brand-700">
          <Type size={18} />
        </span>
        <div className="mt-10 text-lg font-extrabold">تغيير الخط</div>
        <div className="mt-2 text-sm text-muted">الحجم الأصلي {ORIGINAL_FONT}px{fontPx === ORIGINAL_FONT ? '' : ` · المطبق ${fontPx}px`}</div>
      </button>
    </div>
  );
}
