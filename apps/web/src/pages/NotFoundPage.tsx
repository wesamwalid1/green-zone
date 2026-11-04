import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';

export function NotFoundPage() {
  return (
    <Card className="mx-auto mt-10 max-w-lg text-center">
      <div className="text-5xl font-extrabold text-brand-700">404</div>
      <h1 className="mt-3 text-xl font-bold">الصفحة غير موجودة</h1>
      <p className="mt-2 text-sm text-muted">المسار الذي فتحته غير متاح داخل النظام.</p>
      <Link to="/" className="mt-5 inline-block"><Button>العودة للوحة التحكم</Button></Link>
    </Card>
  );
}
