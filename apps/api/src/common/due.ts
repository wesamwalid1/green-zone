function cairoDay(value: Date) {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const [year, month, day] = formatted.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function dueTone(invoiceDate: Date, remaining: number) {
  if (!(remaining > 0.009)) return 'clear' as const;
  const days = Math.round((cairoDay(invoiceDate) + 5 * 86_400_000 - cairoDay(new Date())) / 86_400_000);
  if (days < 0) return 'red' as const;
  if (days < 5) return 'yellow' as const;
  return 'green' as const;
}
