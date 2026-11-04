import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
};

type FeedbackCtx = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const Ctx = createContext<FeedbackCtx | null>(null);

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void; value: string };

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ kind: 'confirm', options, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setDialog({ kind: 'prompt', options, resolve, value: options.defaultValue || '' });
    });
  }, []);

  function closeDialog(result: boolean | string | null) {
    setDialog((current) => {
      if (!current) return null;
      if (current.kind === 'confirm') current.resolve(result === true);
      else current.resolve(typeof result === 'string' ? result : null);
      return null;
    });
  }

  const value = useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
      confirm,
      prompt,
    }),
    [confirm, prompt, push],
  );

  const toneIcon = {
    success: CheckCircle2,
    error: TriangleAlert,
    info: Info,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 start-5 z-[100] flex w-[min(100%-2.5rem,23rem)] flex-col gap-2.5">
        {toasts.map((toast) => {
          const Icon = toneIcon[toast.tone];
          const tone = {
            success: { icon: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', title: 'تمت العملية' },
            error: { icon: 'bg-rose-50 text-rose-600', bar: 'bg-rose-500', title: 'تعذر التنفيذ' },
            info: { icon: 'bg-sky-50 text-sky-600', bar: 'bg-sky-500', title: 'تنبيه' },
          }[toast.tone];
          return (
            <div key={toast.id} className="modal-panel pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 text-sm shadow-2xl ring-1 ring-black/5">
              <span className={`absolute inset-y-0 right-0 w-1 ${tone.bar}`} />
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone.icon}`}><Icon size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900">{tone.title}</div>
                <div className="mt-0.5 leading-6 text-slate-600">{toast.message}</div>
              </div>
              <button
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}
                aria-label="إغلاق"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {dialog && (
        <div className="modal-backdrop fixed inset-0 z-[90] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="modal-panel w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-4">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${dialog.kind === 'confirm' && dialog.options.danger ? 'bg-rose-50 text-rose-600 ring-8 ring-rose-50/60' : 'bg-brand-50 text-brand-700 ring-8 ring-brand-50/60'}`}>
                {dialog.kind === 'confirm' && dialog.options.danger ? <TriangleAlert size={22} /> : <Info size={22} />}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <h2 className="text-lg font-extrabold text-slate-900">{dialog.options.title}</h2>
                {dialog.options.message && <p className="mt-1.5 text-sm leading-6 text-slate-600">{dialog.options.message}</p>}
              </div>
            </div>
            {dialog.kind === 'prompt' && (
              <input
                autoFocus
                className="mt-5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                value={dialog.value}
                onChange={(event) => setDialog({ ...dialog, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') closeDialog(dialog.value);
                  if (event.key === 'Escape') closeDialog(null);
                }}
              />
            )}
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}>
                {dialog.kind === 'confirm' ? dialog.options.cancelLabel || 'إلغاء' : 'إلغاء'}
              </button>
              <button
                autoFocus={dialog.kind === 'confirm'}
                className={`h-10 rounded-xl px-5 text-sm font-bold text-white shadow-sm ${dialog.kind === 'confirm' && dialog.options.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-700 hover:bg-brand-800'}`}
                onClick={() => closeDialog(dialog.kind === 'confirm' ? true : dialog.value)}
              >
                {dialog.options.confirmLabel || (dialog.kind === 'confirm' ? 'تأكيد' : 'متابعة')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFeedback outside provider');
  return ctx;
}

export function useToast() {
  const { success, error, info } = useFeedback();
  return { success, error, info };
}

export function useConfirm() {
  return useFeedback().confirm;
}

export function usePrompt() {
  return useFeedback().prompt;
}
