import type { ReactNode } from 'react';

/** يرسّم مستند الطباعة/PDF خارج الشاشة بدون فتح شاشة البيانات */
export function SilentPrintMount({ children }: { children: ReactNode }) {
  return (
    <div className="silent-print-mount" aria-hidden>
      <div className="print-sheet">{children}</div>
    </div>
  );
}
