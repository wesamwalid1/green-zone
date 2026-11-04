import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  Layers,
  LineChart,
  FileSpreadsheet,
  Handshake,
  Package,
  ScrollText,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Truck,
  Undo2,
  Users,
  UserCog,
  Wallet,
  Warehouse,
} from 'lucide-react';

export type AppRole = 'ADMIN' | 'ACCOUNTANT' | 'WAREHOUSE' | 'SALES';

export type NavItem = {
  to: string;
  label: string;
  page: string;
  icon: LucideIcon;
  end?: boolean;
  keywords: string;
  roles?: AppRole[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدير النظام',
  ACCOUNTANT: 'محاسب',
  WAREHOUSE: 'أمين مخزن',
  SALES: 'مبيعات',
};

/** الأدمن: مدير النظام. باقي الحسابات: المسمى الوظيفي، ولو فاضي من غير نص افتراضي للدور. */
export function displayJobLabel(user?: {
  role?: string;
  jobTitle?: string | null;
} | null): string {
  if (!user) return '';
  if (user.role === 'ADMIN') return ROLE_LABELS.ADMIN;
  const title = user.jobTitle?.trim();
  return title || 'بدون مسمى وظيفي';
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'نظرة عامة',
    items: [
      { to: '/', label: 'لوحة التحكم', page: 'dashboard', icon: LayoutDashboard, end: true, keywords: 'dashboard رئيسية' },
    ],
  },
  {
    label: 'المخزون',
    items: [
      { to: '/warehouses', label: 'المخازن', page: 'warehouses', icon: Warehouse, keywords: 'مخزن warehouse' },
      { to: '/products', label: 'إضافة أصناف', page: 'products', icon: Package, keywords: 'صنف منتج product استيراد import أصناف' },
      { to: '/stock', label: 'المخزون', page: 'stock', icon: Boxes, keywords: 'رصيد حركة stock' },
      { to: '/prod-orders', label: 'أوردر إنتاج', page: 'production', icon: ClipboardList, keywords: 'أوردر انتاج طلب عميل delivery مهندس', roles: ['ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'SALES'] },
      { to: '/work-orders', label: 'أمر تشغيل', page: 'production', icon: Layers, keywords: 'أمر تشغيل تجميع أوردرات work order', roles: ['ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'SALES'] },
    ],
  },
  {
    label: 'الأطراف',
    items: [
      { to: '/suppliers', label: 'الموردين', page: 'suppliers', icon: Truck, keywords: 'مورد supplier' },
      { to: '/customers', label: 'العملاء', page: 'customers', icon: Users, keywords: 'عميل customer' },
    ],
  },
  {
    label: 'العمليات',
    items: [
      { to: '/sales', label: 'المبيعات', page: 'sales', icon: ShoppingCart, keywords: 'فاتورة بيع sales' },
      { to: '/purchases', label: 'المشتريات', page: 'purchases', icon: ShoppingBag, keywords: 'فاتورة شراء purchase' },
      { to: '/returns', label: 'المرتجعات', page: 'returns', icon: Undo2, keywords: 'مرتجع return' },
      { to: '/documents', label: 'عروض وأوامر', page: 'documents', icon: ClipboardList, keywords: 'عرض سعر أمر' },
      { to: '/cash', label: 'الخزنة', page: 'cash', icon: Wallet, keywords: 'نقدي خزنة cash' },
    ],
  },
  {
    label: 'المالية',
    items: [
      { to: '/finance', label: 'المالية', page: 'finance', icon: Landmark, keywords: 'مصروف شيك وردية' },
      { to: '/hr', label: 'الموارد البشرية', page: 'hr', icon: UserCog, keywords: 'مرتبات حضور عمولة موظف payroll hr', roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/partners', label: 'الشركاء', page: 'partners', icon: Handshake, keywords: 'شريك أرباح سحب partner', roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/statements', label: 'كشوف حسابات', page: 'statements', icon: FileSpreadsheet, keywords: 'كشف حساب عميل مورد دائن مدين لينا علينا مقدم statement', roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/reports', label: 'التقارير', page: 'reports', icon: BarChart3, keywords: 'تقرير report' },
      { to: '/report-builder', label: 'منشئ التقارير', page: 'reportBuilder', icon: FileBarChart, keywords: 'report builder حفظ تصدير' },
      { to: '/analytics', label: 'التحليلات', page: 'analytics', icon: LineChart, keywords: 'تحليل analytics نمو' },
      { to: '/insights', label: 'التنبيهات الذكية', page: 'insights', icon: Sparkles, keywords: 'تنبيه صلاحية نقص' },
    ],
  },
  {
    label: 'النظام',
    items: [
      { to: '/audit', label: 'سجل العمليات', page: 'audit', icon: ScrollText, keywords: 'audit سجل', roles: ['ADMIN'] },
      { to: '/settings', label: 'الإعدادات', page: 'settings', icon: Settings, keywords: 'إعداد مستخدم نسخ' },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function canAccess(role: string | undefined, roles?: AppRole[]) {
  if (!roles?.length) return true;
  if (role === 'ADMIN') return true;
  return !!role && roles.includes(role as AppRole);
}

/** أول مسار مسموح بعد الدخول: لوحة التحكم إن وُجدت صلاحيتها، وإلا أول شاشة مفعّلة. */
export function getHomePath(user: {
  role?: string;
  access?: Record<string, { view?: boolean } | undefined>;
} | null | undefined): string {
  if (!user) return '/';
  if (!user.access || user.role === 'ADMIN' || user.access.dashboard?.view) return '/';
  const first = NAV_ITEMS.find((item) => user.access?.[item.page]?.view);
  return first?.to || '/';
}

export const QUICK_ACTIONS: { to: string; label: string; page: string; roles?: AppRole[] }[] = [
  { to: '/sales', label: 'فاتورة مبيعات', page: 'sales', roles: ['ADMIN', 'SALES', 'ACCOUNTANT'] },
  { to: '/purchases', label: 'فاتورة مشتريات', page: 'purchases', roles: ['ADMIN', 'ACCOUNTANT', 'WAREHOUSE'] },
  { to: '/products', label: 'إضافة أصناف', page: 'products' },
  { to: '/stock', label: 'المخزون', page: 'stock' },
  { to: '/cash', label: 'حركة خزنة', page: 'cash', roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/reports', label: 'التقارير', page: 'reports' },
  { to: '/report-builder', label: 'منشئ التقارير', page: 'reportBuilder' },
];
