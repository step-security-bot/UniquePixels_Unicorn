import { CronJob } from 'cron';
import type { Client } from 'discord.js';
import type { Guard, GuardResult } from '@/core/guards';
import { runGuards } from '@/core/guards';
import { attempt, isError } from '@/core/lib/attempt';

/**
 * Context passed to scheduled event actions.
 */
export interface ScheduledContext {
	/** The Discord client */
	client: Client;
	/** The cron job instance */
	job: CronJob;
	/** The scheduled fire time */
	fireDate: Date;
}

/**
 * Action function for scheduled events.
 */
export type ScheduledAction = (ctx: ScheduledContext) => void | Promise<void>;

/**
 * Options for defining a scheduled event spark.
 */
export interface ScheduledEventOptions {
	/** Unique identifier for this scheduled spark */
	id: string;
	/**
	 * Cron expression(s) defining when this spark should run.
	 * Can be a single expression or an array for multiple schedules.
	 * @see https://crontab.guru for cron expression help
	 */
	schedule: string | string[];
	/**
	 * Timezone for the cron schedule.
	 * Use IANA timezone names (e.g., 'America/New_York', 'Europe/London').
	 * @default 'UTC'
	 */
	timezone?: string;
	/** Guards to run before the action (optional) */
	guards?: readonly Guard<ScheduledContext, ScheduledContext>[];
	/** The action to run on each scheduled tick */
	action: ScheduledAction;
}

/**
 * A scheduled event spark instance.
 */
export interface ScheduledEventSpark {
	readonly type: 'scheduled-event';
	readonly id: string;
	readonly schedule: string | string[];
	readonly timezone: string;
	readonly guards: readonly Guard<ScheduledContext, ScheduledContext>[];
	readonly action: ScheduledAction;

	/** Execute the scheduled action (runs guards then action) */
	execute(ctx: ScheduledContext): Promise<GuardResult<ScheduledContext>>;

	/** Register this spark with the client (starts cron jobs) */
	register(client: Client): void;

	/** Stop all cron jobs for this spark */
	stop(client: Client): void;
}

/**
 * Creates a scheduled event spark.
 *
 * @example
 * ```ts
 * // Daily cleanup at midnight UTC
 * export const dailyCleanup = defineScheduledEvent({
 *   id: 'daily-cleanup',
 *   schedule: '0 0 * * *',
 *   action: async (ctx) => {
 *     ctx.client.logger.info('Running daily cleanup...');
 *     await cleanupOldData();
 *   },
 * });
 *
 * // Multiple schedules with timezone
 * export const healthCheck = defineScheduledEvent({
 *   id: 'health-check',
 *   schedule: ['0 9 * * 1-5', '0 17 * * 1-5'], // 9am and 5pm weekdays
 *   timezone: 'America/New_York',
 *   action: async (ctx) => {
 *     ctx.client.logger.debug('Health check tick');
 *   },
 * });
 * ```
 */
export function defineScheduledEvent(
	options: ScheduledEventOptions,
): ScheduledEventSpark {
	const { id, schedule, timezone = 'UTC', guards = [], action } = options;

	return {
		type: 'scheduled-event',
		id,
		schedule,
		timezone,
		guards,
		action,

		async execute(
			ctx: ScheduledContext,
		): Promise<GuardResult<ScheduledContext>> {
			// Run guards
			const guardResult = await runGuards(
				guards as readonly Guard<unknown, unknown>[],
				ctx,
			);

			if (!guardResult.ok) {
				ctx.client.logger.debug(
					{ scheduled: id, reason: guardResult.reason },
					'Scheduled event guard failed',
				);
				return guardResult as GuardResult<ScheduledContext>;
			}

			// Execute action with error handling
			const actionResult = await attempt(() => action(ctx));

			if (isError(actionResult)) {
				ctx.client.logger.error(
					{ err: actionResult.error, scheduled: id },
					'Scheduled event action failed',
				);
			}

			return guardResult as GuardResult<ScheduledContext>;
		},

		register(client: Client): void {
			const schedules = Array.isArray(schedule) ? schedule : [schedule];

			for (const cronExpr of schedules) {
				const job = CronJob.from({
					cronTime: cronExpr,
					timeZone: timezone,
					onTick: async () => {
						const ctx: ScheduledContext = {
							client,
							job,
							fireDate: new Date(),
						};

						client.logger.debug(
							{ scheduled: id, fireDate: ctx.fireDate.toISOString() },
							'Scheduled event tick',
						);

						try {
							await this.execute(ctx);
						} catch (error) {
							client.logger.error(
								{ err: error, scheduled: id },
								'Scheduled event handler failed unexpectedly',
							);
						}
					},
					start: true,
				});

				const jobKey = `${id}:${cronExpr}`;
				client.scheduledJobs.set(jobKey, job);

				client.logger.debug(
					{
						scheduled: id,
						schedule: cronExpr,
						timezone,
						nextRun: job.nextDate().toISO(),
					},
					'Registered scheduled event',
				);
			}
		},

		stop(client: Client): void {
			const schedules = Array.isArray(schedule) ? schedule : [schedule];

			for (const cronExpr of schedules) {
				const jobKey = `${id}:${cronExpr}`;
				const job = client.scheduledJobs.get(jobKey);

				if (job) {
					job.stop();
					client.scheduledJobs.delete(jobKey);
				}
			}

			client.logger.debug({ scheduled: id }, 'Stopped scheduled event');
		},
	};
}

/**
 * Stops all registered scheduled jobs.
 * Call during graceful shutdown.
 */
export function stopAllScheduledJobs(client: Client): void {
	for (const [key, job] of client.scheduledJobs) {
		job.stop();
		client.logger.debug({ key }, 'Stopped scheduled job');
	}
	client.scheduledJobs.clear();
}
