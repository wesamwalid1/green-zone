import { loadExcel } from './excel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function triggerPrint() {
  window.dispatchEvent(new Event('beforeprint'));
  window.setTimeout(() => window.print(), 80);
}

function defaultPdfName() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  return `Green-Zone-${day}.pdf`;
}

function resolvePdfTarget(): HTMLElement {
  const dualPrimary = document.querySelector<HTMLElement>('.print-sheet .dual-print-primary, .dual-print-primary');
  if (dualPrimary) return dualPrimary;

  const silentMount = document.querySelector<HTMLElement>(
    '.silent-print-mount .print-sheet, .silent-print-mount .contract-sheet, .contract-silent-mount .print-sheet, .contract-silent-mount .contract-sheet',
  );
  if (silentMount) return silentMount;

  const contractSheet = document.querySelector<HTMLElement>('.contract-sheet');
  if (contractSheet) return contractSheet;

  const statement = document.querySelector<HTMLElement>('.statement-sheet');
  if (statement) return statement;

  const printSheet = document.querySelector<HTMLElement>('.print-sheet');
  if (printSheet) return printSheet;

  const main = document.querySelector<HTMLElement>('main');
  if (main) return main;

  return document.body;
}

const UNSUPPORTED_COLOR = /oklch|oklab|lab\(|lch\(|color-mix\(/i;

/** يحوّل ألوان Tailwind v4 (oklch) لصيغ يفهمها html2canvas */
function toCanvasSafeColor(color: string, fallback: string): string {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return color || fallback;
  if (!UNSUPPORTED_COLOR.test(color)) return color;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fallback;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    const normalized = String(ctx.fillStyle || '');
    if (!normalized || UNSUPPORTED_COLOR.test(normalized)) return fallback;
    return normalized;
  } catch {
    return fallback;
  }
}

function sanitizeCloneForPdf(root: HTMLElement, view: Window) {
  root.querySelectorAll('.no-print').forEach((el) => el.remove());

  const colorProps = [
    'color',
    'background-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'outline-color',
    'text-decoration-color',
    'column-rule-color',
    'caret-color',
    'fill',
    'stroke',
  ] as const;

  const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const cs = view.getComputedStyle(node);
    for (const prop of colorProps) {
      const value = cs.getPropertyValue(prop);
      if (!value || !UNSUPPORTED_COLOR.test(value)) continue;
      const fallback = prop.includes('background') ? '#ffffff' : '#0f172a';
      node.style.setProperty(prop, toCanvasSafeColor(value, fallback), 'important');
    }

    const bgImage = cs.getPropertyValue('background-image');
    if (bgImage && UNSUPPORTED_COLOR.test(bgImage)) {
      node.style.setProperty('background-image', 'none', 'important');
    }

    node.style.setProperty('box-shadow', 'none', 'important');
    // letter-spacing / uppercase بتكسر رسم الحروف العربية في html2canvas
    if (cs.getPropertyValue('letter-spacing') && cs.getPropertyValue('letter-spacing') !== 'normal') {
      node.style.setProperty('letter-spacing', 'normal', 'important');
    }
    if (cs.getPropertyValue('text-transform') && cs.getPropertyValue('text-transform') !== 'none') {
      node.style.setProperty('text-transform', 'none', 'important');
    }
    if (cs.getPropertyValue('backdrop-filter') && cs.getPropertyValue('backdrop-filter') !== 'none') {
      node.style.setProperty('backdrop-filter', 'none', 'important');
    }
  }

  root.querySelectorAll('.print-header, .print-only').forEach((el) => {
    const node = el as HTMLElement;
    node.style.setProperty('display', 'block', 'important');
    node.style.setProperty('visibility', 'visible', 'important');
    node.style.setProperty('position', 'relative', 'important');
    node.style.setProperty('width', '100%', 'important');
  });

  root.querySelectorAll('.print-meta').forEach((el) => {
    const node = el as HTMLElement;
    node.style.setProperty('position', 'absolute', 'important');
    node.style.setProperty('left', '0', 'important');
    node.style.setProperty('top', '0', 'important');
    node.style.setProperty('right', 'auto', 'important');
    node.style.setProperty('direction', 'ltr', 'important');
    node.style.setProperty('text-align', 'left', 'important');
    node.style.setProperty('white-space', 'nowrap', 'important');
  });

  root.querySelectorAll('.print-brand').forEach((el) => {
    const node = el as HTMLElement;
    node.style.setProperty('position', 'absolute', 'important');
    node.style.setProperty('top', '0', 'important');
    node.style.setProperty('right', '0', 'important');
    node.style.setProperty('left', 'auto', 'important');
    node.style.setProperty('display', 'flex', 'important');
    node.style.setProperty('direction', 'rtl', 'important');
    node.style.setProperty('align-items', 'center', 'important');
  });

  root.querySelectorAll('.print-header-spacer').forEach((el) => {
    (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
  });
}

/** تنزيل PDF فعلي للشاشة القابلة للطباعة (مش نافذة الطباعة) */
export async function triggerPdfSave(fileName = defaultPdfName()) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const source = resolvePdfTarget();
  if (!source || source.childElementCount === 0 && !source.textContent?.trim()) {
    throw new Error('لا يوجد محتوى لتصديره إلى PDF');
  }

  const host = document.createElement('div');
  host.setAttribute('data-pdf-capture-host', '1');
  // خارج الشاشة عشان المستخدم ما يشوفش وميض الورقة أثناء الرسم
  Object.assign(host.style, {
    position: 'fixed',
    left: '-12000px',
    top: '0',
    width: '794px',
    background: '#ffffff',
    color: '#0f172a',
    zIndex: '-1',
    padding: '20px',
    margin: '0',
    overflow: 'visible',
    direction: 'rtl',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    opacity: '1',
  } as CSSStyleDeclaration);

  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.overflow = 'visible';
  clone.style.boxShadow = 'none';
  clone.style.borderRadius = '0';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    sanitizeCloneForPdf(clone, window);

    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: host.scrollWidth,
      windowHeight: host.scrollHeight,
      onclone: (doc, element) => {
        const view = doc.defaultView || window;
        sanitizeCloneForPdf(element as HTMLElement, view);
        doc.querySelectorAll('aside, nav, [data-pdf-capture-host] ~ *').forEach((el) => {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
        });
      },
    });

    if (!canvas.width || !canvas.height) {
      throw new Error('تعذر رسم صفحة PDF — جرّب مرة أخرى');
    }

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= usableHeight;

    while (heightLeft > 2) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= usableHeight;
    }

    const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    pdf.save(safeName);
  } finally {
    host.remove();
  }
}

export async function downloadExcelBuffer(buffer: ArrayBuffer | Blob, fileName: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([buffer]));
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function brandLogoBuffer() {
  const res = await fetch('/green-zone-mark.png');
  if (!res.ok) return null;
  return res.arrayBuffer();
}

/** يضيف لوجو Green Zone أعلى الشيت (يمين في وضع RTL) */
export async function stampBrandLogo(workbook: any, sheet: any) {
  const buffer = await brandLogoBuffer();
  if (!buffer) return;
  const imageId = workbook.addImage({ buffer, extension: 'png' });
  sheet.getRow(1).height = 48;
  sheet.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: 56, height: 56 },
  });
}

/** اتجاه عربي من اليمين لليسار + محاذاة يمين */
export function applyArabicSheetLayout(sheet: any) {
  sheet.views = [{ rightToLeft: true }];
  if (sheet.properties) sheet.properties.defaultColWidth = 16;
  const colCount = Math.max(sheet.columnCount || 0, sheet.actualColumnCount || 0, 1);
  for (let i = 1; i <= colCount; i += 1) {
    const col = sheet.getColumn(i);
    if (!col.width || col.width < 12) col.width = 16;
  }
  sheet.eachRow((row: any) => {
    row.eachCell((cell: any) => {
      cell.alignment = {
        ...(cell.alignment || {}),
        horizontal: 'right',
        vertical: 'middle',
        wrapText: true,
        readingOrder: 'rtl',
      };
    });
  });
}

/** تجهيز شيت عربي: RTL + لوجو + صفوف العلامة */
export async function prepareArabicSheet(workbook: any, sheet: any, opts?: { title?: string; brandRows?: boolean }) {
  sheet.views = [{ rightToLeft: true }];
  await stampBrandLogo(workbook, sheet);
  if (opts?.brandRows !== false) {
    const brand = sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
    brand.font = { bold: true, size: 14, color: { argb: 'FF166534' } };
    if (opts?.title) {
      const titleRow = sheet.addRow([opts.title]);
      titleRow.font = { bold: true, size: 12 };
    }
    sheet.addRow([]);
  }
}

/** تطبيق RTL + لوجو على كل شيتات الورك بوك ثم تنزيل */
export async function finalizeArabicWorkbook(workbook: any, fileName: string, title = 'تقرير Green Zone') {
  const sheets: any[] = workbook.worksheets || [];
  for (const sheet of sheets) {
    const hasImage = (sheet.getImages?.() || []).length > 0;
    if (!hasImage) {
      sheet.spliceRows(1, 0, ['Green Zone', 'للأسمدة والكيماويات'], [title], []);
      await stampBrandLogo(workbook, sheet);
    }
    applyArabicSheetLayout(sheet);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, fileName);
}

export type InvoiceExportLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  extra?: (string | number)[];
};

export async function exportInvoiceExcel(opts: {
  fileName: string;
  title: string;
  meta: [string, string | number][];
  lineHeaders?: string[];
  lines: InvoiceExportLine[];
  totals?: [string, string | number][];
  withLogo?: boolean;
}) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الفاتورة');
  sheet.views = [{ rightToLeft: true }];
  if (opts.withLogo !== false) await stampBrandLogo(workbook, sheet);
  sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
  sheet.addRow([opts.title]);
  sheet.addRow([]);
  opts.meta.forEach(([label, value]) => sheet.addRow([label, value]));
  sheet.addRow([]);
  const headers = opts.lineHeaders || ['الصنف', 'الكمية', 'السعر', 'الإجمالي'];
  sheet.addRow(headers);
  opts.lines.forEach((line) => {
    sheet.addRow([line.name, line.quantity, line.unitPrice, line.total, ...(line.extra || [])]);
  });
  if (opts.totals?.length) {
    sheet.addRow([]);
    opts.totals.forEach(([label, value]) => sheet.addRow([label, value]));
  }
  applyArabicSheetLayout(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, opts.fileName);
}

export async function exportTableExcel(opts: {
  fileName: string;
  sheetName: string;
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(opts.sheetName);
  sheet.views = [{ rightToLeft: true }];
  await stampBrandLogo(workbook, sheet);
  sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
  sheet.addRow([opts.title]);
  sheet.addRow([]);
  sheet.addRow(opts.headers);
  opts.rows.forEach((row) => sheet.addRow(row.map((cell) => cell ?? '')));
  applyArabicSheetLayout(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, opts.fileName);
}
