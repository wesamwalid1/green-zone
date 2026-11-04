/** أصناف من غير مخازن مربوطة = متاحة لكل المخازن (الأصناف القديمة). */
export function productInWarehouse(
  product: { warehouseLinks?: { warehouseId: string }[]; warehouses?: { warehouseId: string }[] },
  warehouseId: string,
) {
  if (!warehouseId) return false;
  const links = product.warehouseLinks || product.warehouses || [];
  if (!links.length) return true;
  return links.some((row) => row.warehouseId === warehouseId);
}

export function productsForWarehouse<T extends { id: string; warehouseLinks?: { warehouseId: string }[]; warehouses?: { warehouseId: string }[] }>(
  products: T[],
  warehouseId: string,
  selectedIds: string[] = [],
) {
  if (!warehouseId) return [] as T[];
  const linked = products.filter((product) => productInWarehouse(product, warehouseId));
  const ids = new Set(linked.map((product) => product.id));
  const extras = selectedIds
    .filter((id) => id && !ids.has(id))
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is T => !!product);
  return [...linked, ...extras];
}
