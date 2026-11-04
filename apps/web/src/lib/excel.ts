export async function loadExcel() {
  const mod = await import('exceljs');
  return mod.default ?? mod;
}
