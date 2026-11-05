import { readFile } from 'fs/promises';
import { join } from 'path';

/** يضبط الشيت عربي من اليمين لليسار */
export function applyArabicSheet(sheet: any) {
  sheet.views = [{ rightToLeft: true }];
  if (sheet.properties) sheet.properties.defaultColWidth = 16;
  const colCount = Math.max(sheet.columnCount || 1, 1);
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

/** يحاول إضافة لوجو الشركة إن وُجد الملف */
export async function stampApiBrandLogo(workbook: any, sheet: any) {
  const candidates = [
    join(process.cwd(), 'apps', 'web', 'public', 'green-zone-mark.png'),
    join(process.cwd(), 'public', 'green-zone-mark.png'),
    join(__dirname, '..', '..', '..', 'web', 'public', 'green-zone-mark.png'),
  ];
  for (const path of candidates) {
    try {
      const buffer = await readFile(path);
      if (typeof sheet.spliceRows === 'function') {
        sheet.spliceRows(1, 0, ['Green Zone', 'للأسمدة والكيماويات'], []);
      }
      const imageId = workbook.addImage({ buffer, extension: 'png' });
      sheet.getRow(1).height = 48;
      sheet.addImage(imageId, {
        tl: { col: 0, row: 0 },
        ext: { width: 56, height: 56 },
      });
      return;
    } catch {
      // جرّب المسار التالي
    }
  }
}
