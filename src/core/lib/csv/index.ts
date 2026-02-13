import { parse as csvParse } from 'csv-parse/sync';
import type * as z from 'zod';

/** Machine-readable error codes thrown by {@link parseCsv}. */
export type CsvErrorCode =
	| 'INVALID_FILE_TYPE'
	| 'FETCH_FAILED'
	| 'PARSE_ERROR'
	| 'EMPTY_CSV'
	| 'MISSING_HEADERS'
	| 'VALIDATION_FAILED';

/** Error thrown by {@link parseCsv} with a typed {@link CsvErrorCode}. */
export class CsvError extends Error {
	/** The error category identifying what went wrong. */
	public readonly code: CsvErrorCode;

	/**
	 * Creates a new CsvError.
	 * @param code - The error category
	 * @param message - Human-readable description
	 * @param options - Standard Error options (e.g. `cause`)
	 */
	public constructor(
		code: CsvErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'CsvError';
		this.code = code;
	}
}

/** Parses CSV text into row objects using csv-parse. */
function parseText(text: string): Record<string, string>[] {
	try {
		return csvParse(text, {
			columns: true,
			// biome-ignore lint/style/useNamingConvention: csv-parse API
			skip_empty_lines: true,
			trim: true,
			// biome-ignore lint/style/useNamingConvention: csv-parse API
			relax_column_count: true,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CsvError('PARSE_ERROR', `Failed to parse CSV: ${message}`, {
			cause: error,
		});
	}
}

/**
 * Fetches a CSV from a URL or reads it from the local filesystem,
 * then validates each row against the provided Zod schema.
 * Headers are inferred from the schema's keys.
 *
 * @param source - A URL or local file path to a `.csv` file
 * @param schema - Zod object schema defining the expected row shape
 * @returns Validated, typed rows
 * @throws {CsvError} with a `code` indicating the failure type
 */
export async function parseCsv<T extends z.ZodObject<z.ZodRawShape>>(
	source: string,
	schema: T,
): Promise<z.infer<T>[]> {
	const text = await fetchCsvText(source);

	const rows = parseText(text);
	const firstRow = rows[0];
	if (!firstRow) {
		throw new CsvError('EMPTY_CSV', 'CSV contains no data rows');
	}

	const headers = Object.keys(firstRow);
	const schemaKeys = Object.keys(schema.shape);
	const missingHeaders = schemaKeys.filter((key) => !headers.includes(key));

	if (missingHeaders.length > 0) {
		throw new CsvError(
			'MISSING_HEADERS',
			`CSV is missing headers: ${missingHeaders.join(', ')}`,
		);
	}

	const validated: z.infer<T>[] = [];
	const errors: string[] = [];

	for (const [index, row] of rows.entries()) {
		const result = schema.safeParse(row);
		if (result.success) {
			validated.push(result.data as z.infer<T>);
		} else {
			const issues = result.error.issues.map((i) => i.message).join(', ');
			errors.push(`Row ${index + 1}: ${issues}`);
		}
	}

	if (errors.length > 0) {
		throw new CsvError(
			'VALIDATION_FAILED',
			`CSV validation failed:\n${errors.join('\n')}`,
		);
	}

	return validated;
}

/** Routes to URL fetch or local file read based on the source string. */
function fetchCsvText(source: string): Promise<string> {
	return isUrl(source) ? fetchFromUrl(source) : readLocalFile(source);
}

/** Fetches CSV text from a URL, validating the response content type. */
async function fetchFromUrl(source: string): Promise<string> {
	const response = await safeFetch(source);
	validateContentType(source, response);
	return response.text();
}

/** Wraps `fetch` to throw {@link CsvError} on network or non-OK responses. */
async function safeFetch(source: string): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CsvError('FETCH_FAILED', `Failed to fetch CSV: ${message}`, {
			cause: error,
		});
	}

	if (!response.ok) {
		throw new CsvError(
			'FETCH_FAILED',
			`Failed to fetch CSV: ${response.status} ${response.statusText}`,
		);
	}

	return response;
}

/** Throws {@link CsvError} if the URL path and content type don't indicate CSV. */
function validateContentType(source: string, response: Response): void {
	const contentType = response.headers.get('content-type') ?? '';
	const pathname = new URL(source).pathname;
	const isCsvPath = pathname.endsWith('.csv');
	const isCsvContent =
		contentType.includes('text/csv') || contentType.includes('text/plain');

	if (!(isCsvPath || isCsvContent)) {
		throw new CsvError(
			'INVALID_FILE_TYPE',
			'Source does not appear to be a CSV file',
		);
	}
}

/** Reads CSV text from a local file, validating the `.csv` extension. */
async function readLocalFile(source: string): Promise<string> {
	if (!source.endsWith('.csv')) {
		throw new CsvError(
			'INVALID_FILE_TYPE',
			'Source does not appear to be a CSV file',
		);
	}

	try {
		return await Bun.file(source).text();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CsvError('FETCH_FAILED', `Failed to read CSV file: ${message}`, {
			cause: error,
		});
	}
}

/** Returns `true` if the source starts with `http://` or `https://`. */
function isUrl(source: string): boolean {
	return source.startsWith('http://') || source.startsWith('https://');
}
