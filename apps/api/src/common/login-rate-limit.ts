import { HttpException, HttpStatus } from '@nestjs/common';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function assertLoginRate(key: string) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    throw new HttpException('محاولات دخول كثيرة. انتظر دقيقة ثم أعد المحاولة.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
