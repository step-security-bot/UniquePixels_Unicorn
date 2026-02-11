import { mock } from 'bun:test';
import type { Guard } from '@/core/guards';

// biome-ignore lint/suspicious/noExplicitAny: test helpers use any for flexible typing
export function passThroughGuard(): Guard<any, any> {
	return mock((input: unknown) => ({ ok: true as const, value: input }));
}

// biome-ignore lint/suspicious/noExplicitAny: test helpers use any for flexible typing
export function failGuard(reason: string): Guard<any, any> {
	return mock(() => ({ ok: false as const, reason }));
}
