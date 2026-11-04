const STORAGE_KEY = 'm5azen_api_url';

let settingsToken = '';
let editToken = '';
let editPrompt: Promise<void> | null = null;

export function setSettingsToken(token: string) {
  settingsToken = token;
}

export function setEditToken(token: string) {
  editToken = token;
}

function askForEditPassword() {
  if (!editPrompt) {
    editPrompt = new Promise<void>((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const cancel = () => {
        cleanup();
        reject(new Error('تم إلغاء التعديل'));
      };
      const cleanup = () => {
        window.removeEventListener('m5azen-edit-password', done);
        window.removeEventListener('m5azen-edit-password-cancel', cancel);
      };
      window.addEventListener('m5azen-edit-password', done);
      window.addEventListener('m5azen-edit-password-cancel', cancel);
      window.dispatchEvent(new Event('m5azen-edit-password-ask'));
    }).finally(() => {
      editPrompt = null;
    });
  }
  return editPrompt;
}

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export function getApiBase(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  // A localhost API saved on this browser is unreachable when the app is opened through a public link.
  const pageIsLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  if (stored && (pageIsLocal || !LOCAL_HOST.test(stored))) return stored.replace(/\/$/, '');
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  return '';
}

export function setApiBase(url: string) {
  const clean = url.trim().replace(/\/$/, '');
  if (clean) localStorage.setItem(STORAGE_KEY, clean);
  else localStorage.removeItem(STORAGE_KEY);
}

export function productImageUrl(id: string, version?: string | null) {
  const token = localStorage.getItem('m5azen_token') || '';
  const stamp = version ? `&v=${encodeURIComponent(version)}` : '';
  return `${getApiBase()}/api/products/${id}/image?token=${encodeURIComponent(token)}${stamp}`;
}

export async function api<T>(
  path: string,
  options: RequestInit & { editRetried?: boolean } = {},
): Promise<T> {
  const token = localStorage.getItem('m5azen_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (settingsToken) headers['x-settings-token'] = settingsToken;
  if (editToken) headers['x-edit-token'] = editToken;

  const { editRetried, ...request } = options;
  const res = await fetch(`${getApiBase()}${path.startsWith('/api') ? path : `/api${path}`}`, {
    ...request,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem('m5azen_token');
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
    throw new Error('غير مصرح');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'حدث خطأ' }));
    const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    if (res.status === 403 && msg === 'أدخل كلمة سر التعديل' && !editRetried) {
      await askForEditPassword();
      return api<T>(path, { ...options, editRetried: true });
    }
    throw new Error(msg || 'حدث خطأ');
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.blob() as Promise<T>;
}

export function formatMoney(n: number) {
  const value = Number(n) || 0;
  const whole = Math.abs(value - Math.round(value)) < 0.005;
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    numberingSystem: 'latn',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
    useGrouping: true,
  }).format(whole ? Math.round(value) : value);
}

/** موجب = دائن · سالب = مدين (بسالب واضح) */
export function formatSignedMoney(n: number) {
  const abs = formatMoney(Math.abs(n || 0));
  if ((n || 0) < -0.009) return `−${abs}`;
  if ((n || 0) > 0.009) return abs;
  return formatMoney(0);
}

export function balanceSide(n: number): 'دائن' | 'مدين' | 'صفر' {
  if ((n || 0) > 0.009) return 'دائن';
  if ((n || 0) < -0.009) return 'مدين';
  return 'صفر';
}

export function formatDate(d: string | Date) {
  return new Intl.DateTimeFormat('ar-EG', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(d));
}

export function formatRelative(d: string | Date) {
  const date = new Date(d);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.round(hours / 24);
  if (days < 7) return `منذ ${days} ي`;
  return formatDate(date);
}

export function initialQuery() {
  return new URLSearchParams(window.location.search).get('q') || '';
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكدة',
  PARTIAL: 'جزئي',
  PAID: 'مدفوعة',
  CANCELLED: 'ملغاة',
};
