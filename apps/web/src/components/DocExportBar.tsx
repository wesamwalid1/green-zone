import { useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from './ui';
import { triggerPdfSave, triggerPrint } from '../lib/docExport';

export function DocExportBar({
  onExcel,
  className = '',
  pdfFileName,
}: {
  onExcel?: () => void | Promise<void>;
  className?: string;
  pdfFileName?: string;
}) {
  const [busyPdf, setBusyPdf] = useState(false);

  return (
    <div className={`flex flex-wrap justify-end gap-2 no-print ${className || 'mb-4'}`}>
      <Button variant="secondary" onClick={() => triggerPrint()}>
        <Printer size={14} /> طباعة
      </Button>
      <Button
        variant="secondary"
        disabled={busyPdf}
        onClick={async () => {
          setBusyPdf(true);
          try {
            await triggerPdfSave(pdfFileName);
          } catch (err) {
            console.error(err);
            window.alert(err instanceof Error ? err.message : 'تعذر تنزيل PDF');
          } finally {
            setBusyPdf(false);
          }
        }}
        title="تنزيل ملف PDF مباشرة"
      >
        <Download size={14} /> {busyPdf ? 'جاري PDF…' : 'تنزيل PDF'}
      </Button>
      {onExcel && (
        <Button variant="secondary" onClick={() => void onExcel()}>
          <FileSpreadsheet size={14} /> Excel
        </Button>
      )}
    </div>
  );
}
