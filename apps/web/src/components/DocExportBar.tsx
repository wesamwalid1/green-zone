import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from './ui';
import { triggerPdfSave, triggerPrint } from '../lib/docExport';

export function DocExportBar({
  onExcel,
  className = '',
}: {
  onExcel?: () => void | Promise<void>;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap justify-end gap-2 no-print ${className || 'mb-4'}`}>
      <Button variant="secondary" onClick={() => triggerPrint()}>
        <Printer size={14} /> طباعة
      </Button>
      <Button
        variant="secondary"
        onClick={() => triggerPdfSave()}
        title="من نافذة الطباعة اختر حفظ كـ PDF"
      >
        <Download size={14} /> تنزيل PDF
      </Button>
      {onExcel && (
        <Button variant="secondary" onClick={() => void onExcel()}>
          <FileSpreadsheet size={14} /> Excel
        </Button>
      )}
    </div>
  );
}
