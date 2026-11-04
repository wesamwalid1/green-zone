import type { ReactNode } from 'react';

/** على الشاشة مرة واحدة · عند الطباعة نسختين تحت بعض في نفس الصفحة */
export function DualPrintCopies({
  children,
  dense,
}: {
  children: ReactNode;
  /** خط أصغر لو البنود كتيرة */
  dense?: boolean;
}) {
  return (
    <div className={`dual-print-root${dense ? ' dual-print-dense' : ''}`}>
      <div className="dual-print-half dual-print-primary">{children}</div>
      <div className="dual-print-half dual-print-clone print-only" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
