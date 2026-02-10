import { describe, expect, mock, spyOn, test } from 'bun:test';
import { CronJob } from 'cron';
import { Collection } from 'discord.js';
import type { UnicornClient } from '@/core/client';
import {
	type ScheduledContext,
	defineScheduledEvent,
	stopAllScheduledJobs,
} from './scheduled-event';

// ─── Test Helpers ────────────────────────────────────────────────

function createMockClient(): UnicornClient {
	return {
		scheduledJobs: new Collection(),
		logger: {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		},
	} as unknown as UnicornClient;
}

function createMockContext(
	client: UnicornClient,
	overrides: Partial<ScheduledContext> = {},
): ScheduledContext {
	return {
		client,
		job: { stop: mock(() => {}) } as unknown as CronJob,
		fireDate: new Date('2025-01-01T00:00:00Z'),
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────

describe('defineScheduledEvent', () => {
	test('creates spark with correct type', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.type).toBe('scheduled-event');
	});

	test('sets id from options', () => {
		const spark = defineScheduledEvent({
			id: 'daily-cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.id).toBe('daily-cleanup');
	});

	test('stores single schedule string', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.schedule).toBe('0 0 * * *');
	});

	test('stores array of schedules', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
			action: async () => {},
		});

		expect(spark.schedule).toEqual(['0 9 * * 1-5', '0 17 * * 1-5']);
	});

	test('defaults timezone to UTC', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.timezone).toBe('UTC');
	});

	test('preserves custom timezone', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			timezone: 'America/New_York',
			action: async () => {},
		});

		expect(spark.timezone).toBe('America/New_York');
	});

	test('defaults guards to empty array', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const guard = mock(
			(input: ScheduledContext) =>
				({ ok: true as const, value: input }) as const,
		);
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			guards: [guard],
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
		expect(spark.guards[0]).toBe(guard);
	});

	test('stores action reference', () => {
		const action = mock(async () => {});
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action,
		});

		expect(spark.action).toBe(action);
	});

	describe('execute', () => {
		test('calls action when no guards are defined', async () => {
			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action,
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(ctx);
		});

		test('runs guards and calls action on success', async () => {
			const guard = mock(
				(input: ScheduledContext) =>
					({ ok: true as const, value: input }) as const,
			);
			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(true);
			expect(guard).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledTimes(1);
		});

		test('returns guard failure and does NOT call action', async () => {
			const guard = mock(() => ({
				ok: false as const,
				reason: 'Not allowed',
			}));
			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Not allowed');
			}
			expect(action).not.toHaveBeenCalled();
		});

		test('logs debug on guard failure', async () => {
			const guard = mock(() => ({
				ok: false as const,
				reason: 'Maintenance mode',
			}));
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				guards: [guard],
				action: async () => {},
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			await spark.execute(ctx);

			expect(client.logger.debug).toHaveBeenCalledWith(
				{ scheduled: 'cleanup', reason: 'Maintenance mode' },
				'Scheduled event guard failed',
			);
		});

		test('logs error when action throws', async () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {
					throw new Error('action broke');
				},
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			await spark.execute(ctx);

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ scheduled: 'cleanup' }),
				'Scheduled event action failed',
			);
		});

		test('returns ok result even when action throws', async () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {
					throw new Error('boom');
				},
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(true);
		});
	});

	describe('register', () => {
		test('creates CronJob for single schedule and stores in scheduledJobs', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.has('cleanup:0 0 * * *')).toBe(true);
			const job = client.scheduledJobs.get('cleanup:0 0 * * *');
			expect(job).toBeInstanceOf(CronJob);
		});

		test('onTick callback calls execute and logs debug', async () => {
			let capturedOnTick: (() => Promise<void>) | undefined;
			const fakeJob = {
				stop: mock(() => {}),
				nextDate: () => ({ toISO: () => '2025-01-01T00:00:00.000Z' }),
			};
			const cronFromSpy = spyOn(CronJob, 'from').mockImplementation(
				((params: { onTick: () => Promise<void> }) => {
					capturedOnTick = params.onTick;
					return fakeJob as unknown as CronJob;
				}) as unknown as typeof CronJob.from,
			);

			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'tick-test',
				schedule: '* * * * * *',
				action,
			});

			const client = createMockClient();
			spark.register(client);

			// Invoke captured onTick directly instead of waiting for real time
			expect(capturedOnTick).toBeDefined();
			await capturedOnTick!();

			spark.stop(client);
			cronFromSpy.mockRestore();

			expect(action).toHaveBeenCalled();
			expect(client.logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ scheduled: 'tick-test' }),
				'Scheduled event tick',
			);
		});

		test('onTick callback catches unexpected errors from execute', async () => {
			let capturedOnTick: (() => Promise<void>) | undefined;
			const fakeJob = {
				stop: mock(() => {}),
				nextDate: () => ({ toISO: () => '2025-01-01T00:00:00.000Z' }),
			};
			const cronFromSpy = spyOn(CronJob, 'from').mockImplementation(
				((params: { onTick: () => Promise<void> }) => {
					capturedOnTick = params.onTick;
					return fakeJob as unknown as CronJob;
				}) as unknown as typeof CronJob.from,
			);

			const throwingGuard = mock(() => {
				throw new Error('guard exploded');
			});
			const spark = defineScheduledEvent({
				id: 'err-test',
				schedule: '* * * * * *',
				guards: [throwingGuard],
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			// Invoke captured onTick directly instead of waiting for real time
			expect(capturedOnTick).toBeDefined();
			await capturedOnTick!();

			spark.stop(client);
			cronFromSpy.mockRestore();

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ scheduled: 'err-test' }),
				'Scheduled event handler failed unexpectedly',
			);
		});

		test('creates multiple CronJobs for array schedule', () => {
			const spark = defineScheduledEvent({
				id: 'health',
				schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.has('health:0 9 * * 1-5')).toBe(true);
			expect(client.scheduledJobs.has('health:0 17 * * 1-5')).toBe(true);
			expect(client.scheduledJobs.size).toBe(2);
		});

		test('logs debug with schedule info for each job', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				timezone: 'America/New_York',
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					scheduled: 'cleanup',
					schedule: '0 0 * * *',
					timezone: 'America/New_York',
				}),
				'Registered scheduled event',
			);
		});
	});

	describe('stop', () => {
		test('stops jobs and removes from scheduledJobs', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.size).toBe(1);
			spark.stop(client);

			expect(client.scheduledJobs.size).toBe(0);
		});

		test('stops all jobs for array schedule', () => {
			const spark = defineScheduledEvent({
				id: 'health',
				schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.size).toBe(2);
			spark.stop(client);

			expect(client.scheduledJobs.size).toBe(0);
		});

		test('handles gracefully when jobs do not exist', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			// Don't register — stop should not throw
			spark.stop(client);

			expect(client.scheduledJobs.size).toBe(0);
		});

		test('logs debug message', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			spark.stop(client);

			expect(client.logger.debug).toHaveBeenCalledWith(
				{ scheduled: 'cleanup' },
				'Stopped scheduled event',
			);
		});
	});
});

describe('stopAllScheduledJobs', () => {
	test('stops all jobs in scheduledJobs collection', () => {
		const client = createMockClient();

		// Register two sparks
		const spark1 = defineScheduledEvent({
			id: 'job1',
			schedule: '0 0 * * *',
			action: async () => {},
		});
		const spark2 = defineScheduledEvent({
			id: 'job2',
			schedule: '0 12 * * *',
			action: async () => {},
		});
		spark1.register(client);
		spark2.register(client);

		expect(client.scheduledJobs.size).toBe(2);

		stopAllScheduledJobs(client);

		expect(client.scheduledJobs.size).toBe(0);
	});

	test('logs debug for each stopped job', () => {
		const client = createMockClient();

		const spark = defineScheduledEvent({
			id: 'job1',
			schedule: '0 0 * * *',
			action: async () => {},
		});
		spark.register(client);

		// Reset mock after registration logging
		(client.logger.debug as ReturnType<typeof mock>).mockClear();

		stopAllScheduledJobs(client);

		expect(client.logger.debug).toHaveBeenCalledWith(
			{ key: 'job1:0 0 * * *' },
			'Stopped scheduled job',
		);
	});

	test('handles empty collection without errors', () => {
		const client = createMockClient();

		// Should not throw
		stopAllScheduledJobs(client);

		expect(client.scheduledJobs.size).toBe(0);
	});
});
