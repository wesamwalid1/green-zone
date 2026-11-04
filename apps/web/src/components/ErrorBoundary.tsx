import { Component, type ReactNode } from 'react';
import { Button, Card } from './ui';

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card className="mx-auto mt-10 max-w-lg text-center">
        <div className="text-5xl font-extrabold text-rose-700">500</div>
        <h1 className="mt-3 text-xl font-bold">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-sm text-muted">{this.state.error.message}</p>
        <Button className="mt-5" onClick={() => window.location.reload()}>إعادة تحميل</Button>
      </Card>
    );
  }
}
