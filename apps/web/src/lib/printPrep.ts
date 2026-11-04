/** تجهيز الطباعة: فاتورة بنسختين في أول صفحة · كشف حساب متعدد الصفحات */
export function installPrintPrep() {
  const MOUNT_ID = 'invoice-print-mount';

  const prep = () => {
    const dual = document.querySelector('.dual-print-root');
    if (dual) {
      // انسخ الفاتورة لأول الـ body عشان تطلع في الصفحة الأولى (من غير صفحة فاضية)
      let mount = document.getElementById(MOUNT_ID);
      if (!mount) {
        mount = document.createElement('div');
        mount.id = MOUNT_ID;
        document.body.insertBefore(mount, document.body.firstChild);
      }
      mount.innerHTML = '';
      const clone = dual.cloneNode(true) as HTMLElement;
      clone.classList.add('dual-print-root--mounted');
      // أظهر النسخة المستنسخة حتى لو كانت print-only في الأصل
      clone.querySelectorAll('.print-only, .dual-print-clone').forEach((el) => {
        (el as HTMLElement).style.display = 'block';
        (el as HTMLElement).style.visibility = 'visible';
      });
      mount.appendChild(clone);
      document.body.classList.add('is-printing', 'printing-dual-invoice');
      document.documentElement.style.setProperty('--print-sheet-h', '100vh');
      return;
    }

    document.getElementById(MOUNT_ID)?.remove();

    const sheets = Array.from(document.querySelectorAll<HTMLElement>('.print-sheet'));
    if (!sheets.length) return;
    let max = 0;
    for (const el of sheets) {
      el.style.maxHeight = 'none';
      el.style.height = 'auto';
      el.style.overflow = 'visible';
      const h = Math.max(el.scrollHeight, el.offsetHeight);
      if (h > max) max = h;
    }
    document.documentElement.style.setProperty('--print-sheet-h', `${Math.ceil(max + 48)}px`);
    document.body.classList.add('is-printing');
  };

  const cleanup = () => {
    document.getElementById(MOUNT_ID)?.remove();
    document.body.classList.remove('is-printing', 'printing-dual-invoice');
    document.documentElement.style.removeProperty('--print-sheet-h');
  };

  window.addEventListener('beforeprint', prep);
  window.addEventListener('afterprint', cleanup);
}
