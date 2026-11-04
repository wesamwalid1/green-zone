export const ORIGINAL_COLOR = '#1a3050';
export const ORIGINAL_FONT = 16;
export const MIN_FONT = 12;
export const MAX_FONT = 20;

const COLOR_KEY = 'm5azen.appearance.color';
const FONT_KEY = 'm5azen.appearance.font';

const ORIGINAL_SCALE: Record<string, string> = {
  '--color-brand-50': '#f2f5f9',
  '--color-brand-100': '#e4eaf2',
  '--color-brand-200': '#c5d1e0',
  '--color-brand-300': '#9aafc8',
  '--color-brand-400': '#6b87a8',
  '--color-brand-500': '#4a6a8f',
  '--color-brand-600': '#2b4e7d',
  '--color-brand-700': '#1a3050',
  '--color-brand-800': '#14263f',
  '--color-brand-900': '#0f1c2e',
  '--color-brand-950': '#0a1320',
  '--color-navy': '#1a3050',
  '--color-navy-deep': '#0f1c2e',
  '--color-navy-mid': '#2b4e7d',
  '--status-confirmed': '#e4eaf2',
  '--status-confirmed-text': '#1a3050',
};

export const COLOR_CHOICES = [
  '#3f6b4a', '#5c6b2f', '#d4a017', '#e0b000', '#a3a03a', '#6d8a32', '#5f8f6a', '#8aa07a', '#6e8444', '#e07a3d',
  '#1f7a4d', '#145c32', '#243044', '#e8892a', '#f0a020', '#d7a48a', '#c4a574', '#a67c52', '#8b5e3c', '#1f6f5b',
  '#0e6b4f', '#0b3d2e', '#1c2430', '#d35400', '#c2410c', '#d9897c', '#b57a68', '#8f5e49', '#5e8a84', '#2f6f5e',
  '#c0392b', '#db2777', '#9b2d6a', '#6b3fa0', '#5c4d7a', '#2c3e8f', '#1e4b8f', '#3d6cb5', '#64748b', '#1e7a46',
  '#a32020', '#be185d', '#7e1d5a', '#4a1c6b', '#8d7f93', '#5b4d68', '#1a3050', '#1e2a4a', '#334155', '#dc2626',
  '#6b1d3a',
];

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(base: string, target: string, amount: number) {
  const from = hexToRgb(base);
  const to = hexToRgb(target);
  return rgbToHex(
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  );
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readable(hex: string) {
  let color = hex;
  for (let step = 0; step < 6 && luminance(color) > 0.42; step += 1) color = mix(color, '#0a1320', 0.22);
  return color;
}

function scaleFor(color: string) {
  if (color.toLowerCase() === ORIGINAL_COLOR) return ORIGINAL_SCALE;
  const brand = readable(color);
  const scale = {
    '--color-brand-50': mix(brand, '#ffffff', 0.92),
    '--color-brand-100': mix(brand, '#ffffff', 0.84),
    '--color-brand-200': mix(brand, '#ffffff', 0.68),
    '--color-brand-300': mix(brand, '#ffffff', 0.5),
    '--color-brand-400': mix(brand, '#ffffff', 0.3),
    '--color-brand-500': mix(brand, '#ffffff', 0.14),
    '--color-brand-600': mix(brand, '#ffffff', 0.1),
    '--color-brand-700': brand,
    '--color-brand-800': mix(brand, '#000000', 0.22),
    '--color-brand-900': mix(brand, '#000000', 0.4),
    '--color-brand-950': mix(brand, '#000000', 0.55),
  };
  return {
    ...scale,
    '--color-navy': brand,
    '--color-navy-deep': scale['--color-brand-900'],
    '--color-navy-mid': scale['--color-brand-600'],
    '--status-confirmed': scale['--color-brand-100'],
    '--status-confirmed-text': brand,
  };
}

function readRaw(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference stays for this visit */
  }
}

export function readAppearance() {
  const color = readRaw(COLOR_KEY);
  const font = Number(readRaw(FONT_KEY));
  return {
    color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : ORIGINAL_COLOR,
    fontPx: Number.isFinite(font) && font >= MIN_FONT && font <= MAX_FONT ? font : ORIGINAL_FONT,
  };
}

export function applyAppearance(color: string, fontPx: number) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const scale = scaleFor(color);
  Object.entries(scale).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.fontSize = `${fontPx}px`;
}

export function saveAppearance(color: string, fontPx: number) {
  writeRaw(COLOR_KEY, color.toLowerCase());
  writeRaw(FONT_KEY, String(fontPx));
  applyAppearance(color, fontPx);
}

if (typeof document !== 'undefined') {
  const saved = readAppearance();
  applyAppearance(saved.color, saved.fontPx);
}
