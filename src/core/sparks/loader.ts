import { relative } from 'node:path';
import process from 'node:process';
import type { UnicornClient } from '@/core/client';
import type { CommandSpark } from './command';
import type { ComponentSpark } from './component';
import type { GatewayEventSpark } from './gateway-event';
import type { ScheduledEventSpark } from './scheduled-event';

/**
 * All spark types.
 */
export type AnySpark =
	| CommandSpark
	| ComponentSpark
	| GatewayEventSpark
	| ScheduledEventSpark;

/**
 * Valid spark type identifiers.
 */
export type SparkType = AnySpark['type'];

/**
 * Result of loading sparks from a directory.
 */
export interface LoadSparksResult {
	/** Total number of sparks loaded */
	total: number;
	/** Number of command sparks loaded */
	commands: number;
	/** Number of component sparks loaded */
	components: number;
	/** Number of gateway event sparks loaded */
	events: number;
	/** Number of scheduled sparks loaded */
	scheduled: number;
}

/**
 * Options for the spark loader.
 */
export interface LoadSparksOptions {
	/** File extensions to consider as spark files */
	extensions?: string[];
	/** Patterns to exclude (e.g., test files) */
	exclude?: RegExp[];
}

const DEFAULT_OPTIONS: Required<LoadSparksOptions> = {
	extensions: ['.ts', '.js'],
	exclude: [/\.test\.[tj]s$/, /\.spec\.[tj]s$/, /__tests__/],
};

/**
 * Valid spark type values.
 */
const SPARK_TYPES: Set<SparkType> = new Set<SparkType>([
	'command',
	'component',
	'gateway-event',
	'scheduled-event',
]);

/**
 * Type guard to check if a value is a spark instance.
 */
function isSpark(value: unknown): value is AnySpark {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		typeof (value as { type: unknown }).type === 'string' &&
		SPARK_TYPES.has((value as { type: SparkType }).type) &&
		'register' in value &&
		typeof (value as { register: unknown }).register === 'function'
	);
}

/**
 * Recursively finds all files in a directory using async Bun.glob().
 * More performant than synchronous fs operations for large directories.
 */
async function findFiles(
	dir: string,
	options: Required<LoadSparksOptions>,
): Promise<string[]> {
	// Build glob pattern from extensions (e.g., "**/*.{ts,js}")
	const extPattern =
		options.extensions.length === 1
			? `**/*${options.extensions[0]}`
			: `**/*.{${options.extensions.map((e) => e.slice(1)).join(',')}}`;

	const glob = new Bun.Glob(extPattern);
	const files: string[] = [];

	for await (const file of glob.scan({ cwd: dir, absolute: true })) {
		const isExcluded = options.exclude.some((pattern) => pattern.test(file));
		if (!isExcluded) {
			files.push(file);
		}
	}

	return files;
}

/**
 * Gets a unique identifier for a spark (for logging purposes).
 */
function getSparkId(spark: AnySpark): string {
	if (spark.type === 'command') {
		return spark.id;
	}
	if (spark.type === 'component') {
		return spark.key;
	}
	if (spark.type === 'gateway-event') {
		return String(spark.event);
	}
	if (spark.type === 'scheduled-event') {
		return spark.id;
	}
	return 'unknown';
}

/**
 * Loads and registers all sparks from a directory.
 *
 * This function:
 * 1. Recursively finds all TypeScript/JavaScript files in the directory
 * 2. Imports each file
 * 3. Finds all exported spark instances (created via defineCommand, defineComponent, etc.)
 * 4. Calls register(client) on each spark
 *
 * **THROWS** on any error during loading - startup errors should terminate the application.
 *
 * @param client - The UnicornClient to register sparks with
 * @param directory - The directory to scan for spark files
 * @param options - Optional configuration
 * @returns Summary of loaded sparks
 *
 * @throws Error if any spark fails to load or register
 *
 * @example
 * ```ts
 * const result = await loadSparks(client, './src/sparks');
 * logger.info(`Loaded ${result.total} sparks`);
 * ```
 */
export async function loadSparks(
	client: UnicornClient,
	directory: string,
	options: LoadSparksOptions = {},
): Promise<LoadSparksResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const result: LoadSparksResult = {
		total: 0,
		commands: 0,
		components: 0,
		events: 0,
		scheduled: 0,
	};

	// Find all spark files
	const files = await findFiles(directory, opts);

	client.logger.debug(
		{ directory, fileCount: files.length },
		'Found spark files',
	);

	// Import and process each file
	for (const filePath of files) {
		const relativePath = relative(process.cwd(), filePath);

		try {
			// Dynamic import
			// biome-ignore lint/performance/noAwaitInLoops: sequential loading ensures deterministic registration order
			const module = (await import(filePath)) as Record<string, unknown>;

			// Find all exported spark instances
			for (const [exportName, exportValue] of Object.entries(module)) {
				if (isSpark(exportValue)) {
					const spark = exportValue;

					// Register the spark
					spark.register(client);
					result.total++;

					// Track type for logging
					switch (spark.type) {
						case 'command':
							result.commands++;
							break;
						case 'component':
							result.components++;
							break;
						case 'gateway-event':
							result.events++;
							break;
						case 'scheduled-event':
							result.scheduled++;
							break;
						default: {
							// Exhaustive check - this should never happen since isSpark validates the type
							const _exhaustive: never = spark;
							client.logger.warn(
								{ type: (_exhaustive as AnySpark).type },
								'Unknown spark type encountered',
							);
						}
					}

					client.logger.debug(
						{
							spark: getSparkId(spark),
							type: spark.type,
							file: relativePath,
							export: exportName,
						},
						'Loaded spark',
					);
				}
			}
		} catch (error) {
			// Re-throw with context - startup errors should terminate
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to load spark from ${relativePath}: ${message}`, {
				cause: error,
			});
		}
	}

	client.logger.info(
		{
			total: result.total,
			commands: result.commands,
			components: result.components,
			events: result.events,
			scheduled: result.scheduled,
		},
		'Sparks loaded',
	);

	return result;
}

/**
 * Collects all command builders for registration with Discord.
 * Call this after loading sparks to get the commands for REST registration.
 */
export function collectCommandBuilders(
	client: UnicornClient,
): CommandSpark['command'][] {
	return Array.from(client.commands.values()).map((spark) => spark.command);
}
