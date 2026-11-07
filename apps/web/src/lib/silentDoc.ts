import { triggerPdfSave, triggerPrint } from './docExport';

/** انتظار رسم React + استقرار DOM */
export function afterPaint(ms = 160): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, ms);
      });
    });
  });
}

/** طباعة ثم تنظيف الطبقة الصامتة */
export function runSilentPrint(cleanup: () => void) {
  const onAfterPrint = () => {
    window.removeEventListener('afterprint', onAfterPrint);
    cleanup();
  };
  window.addEventListener('afterprint', onAfterPrint);
  triggerPrint();
  window.setTimeout(() => {
    window.removeEventListener('afterprint', onAfterPrint);
    cleanup();
  }, 60_000);
}

/** PDF من الطبقة الصامتة ثم تنظيف */
export async function runSilentPdf(fileName: string, cleanup: () => void) {
  try {
    await triggerPdfSave(fileName);
  } finally {
    cleanup();
  }
}
