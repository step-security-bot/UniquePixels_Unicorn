import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as z from 'zod';
import { CsvError, type CsvErrorCode, parseCsv } from './index.ts';

const schema = z.object({
	Name: z.string().min(1, 'Name is required'),
	Email: z.string().optional().default(''),
});

let pathCounter = 0;
function uniqueCsvPath() {
	return `/mock/data-${Date.now()}-${pathCounter++}.csv`;
}

function mockLocalFile(content: string) {
	const bunFile = mock(() => ({ text: () => Promise.resolve(content) }));
	// @ts-expect-error -- partial mock of Bun.file for testing
	Bun.file = bunFile;
	return bunFile;
}

function mockFetch(content: string, contentType = 'text/csv') {
	const fetchMock = mock(() =>
		Promise.resolve({
			ok: true,
			status: 200,
			statusText: 'OK',
			text: () => Promise.resolve(content),
			headers: new Headers({ 'content-type': contentType }),
		}),
	);
	// @ts-expect-error -- partial mock of global fetch
	globalThis.fetch = fetchMock;
	return fetchMock;
}

const originalBunFile = Bun.file;
const originalFetch = globalThis.fetch;

afterEach(() => {
	Bun.file = originalBunFile;
	globalThis.fetch = originalFetch;
});

async function parseMockedCsv(content: string) {
	mockLocalFile(content);
	return parseCsv(uniqueCsvPath(), schema);
}

async function expectCsvError(content: string, code: CsvErrorCode, patterns?: RegExp | RegExp[]) {
	mockLocalFile(content);
	try {
		await parseCsv(uniqueCsvPath(), schema);
		expect.unreachable('Expected CsvError to be thrown');
	} catch (error_) {
		expect(error_).toBeInstanceOf(CsvError);
		if (error_ instanceof CsvError) {
			expect(error_.code).toBe(code);
			if (patterns) {
				for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
					expect(error_.message).toMatch(pattern);
				}
			}
		}
	}
}

describe('parseCsv', () => {
	describe('file type validation', () => {
		test('rejects non-csv local file paths', async () => {
			try {
				await parseCsv('/mock/data.txt', schema);
				expect.unreachable('Expected CsvError to be thrown');
			} catch (error_) {
				expect(error_).toBeInstanceOf(CsvError);
				if (error_ instanceof CsvError) {
					expect(error_.code).toBe('INVALID_FILE_TYPE');
				}
			}
		});

		test('rejects URL with non-csv path and non-csv content type', async () => {
			mockFetch('not csv', 'application/json');
			try {
				await parseCsv('https://example.com/data.json', schema);
				expect.unreachable('Expected CsvError to be thrown');
			} catch (error_) {
				expect(error_).toBeInstanceOf(CsvError);
				if (error_ instanceof CsvError) {
					expect(error_.code).toBe('INVALID_FILE_TYPE');
				}
			}
		});

		test('accepts URL with .csv path', async () => {
			mockFetch('Name,Email\nAlice,alice@test.com\n', 'application/octet-stream');
			const rows = await parseCsv('https://cdn.example.com/file.csv?token=abc', schema);
			expect(rows).toHaveLength(1);
		});

		test('accepts URL with text/csv content type', async () => {
			mockFetch('Name,Email\nAlice,alice@test.com\n', 'text/csv');
			const rows = await parseCsv('https://example.com/download', schema);
			expect(rows).toHaveLength(1);
		});

		test('accepts URL with text/plain content type', async () => {
			mockFetch('Name,Email\nAlice,alice@test.com\n', 'text/plain');
			const rows = await parseCsv('https://example.com/download', schema);
			expect(rows).toHaveLength(1);
		});

		test('throws FETCH_FAILED when fetch rejects', async () => {
			// @ts-expect-error -- partial mock of global fetch
		globalThis.fetch = mock(() => Promise.reject(new Error('Network error')));
			try {
				await parseCsv('https://example.com/data.csv', schema);
				expect.unreachable('Expected CsvError to be thrown');
			} catch (error_) {
				expect(error_).toBeInstanceOf(CsvError);
				if (error_ instanceof CsvError) {
					expect(error_.code).toBe('FETCH_FAILED');
					expect(error_.message).toMatch(/Network error/);
				}
			}
		});

		test('throws FETCH_FAILED when response is not ok', async () => {
			// @ts-expect-error -- partial mock of global fetch
			globalThis.fetch = mock(() =>
				Promise.resolve({
					ok: false,
					status: 404,
					statusText: 'Not Found',
					headers: new Headers(),
				}),
			);
			try {
				await parseCsv('https://example.com/data.csv', schema);
				expect.unreachable('Expected CsvError to be thrown');
			} catch (error_) {
				expect(error_).toBeInstanceOf(CsvError);
				if (error_ instanceof CsvError) {
					expect(error_.code).toBe('FETCH_FAILED');
					expect(error_.message).toMatch(/404/);
				}
			}
		});

		test('accepts .csv local file extension', async () => {
			const rows = await parseMockedCsv('Name,Email\nAlice,alice@example.com\n');
			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@example.com' });
		});
	});

	describe('empty csv', () => {
		test('throws EMPTY_CSV for header-only file', async () => {
			await expectCsvError('Name,Email\n', 'EMPTY_CSV');
		});

		test('throws EMPTY_CSV for completely empty file', async () => {
			await expectCsvError('', 'EMPTY_CSV');
		});
	});

	describe('header validation', () => {
		test('throws MISSING_HEADERS when required headers are absent', async () => {
			await expectCsvError('Name\nAlice\n', 'MISSING_HEADERS');
		});

		test('includes missing header names in error message', async () => {
			await expectCsvError('Other\ndata\n', 'MISSING_HEADERS', [/Name/, /Email/]);
		});

		test('allows extra headers beyond the schema', async () => {
			const rows = await parseMockedCsv('Name,Email,Extra\nAlice,alice@test.com,bonus\n');
			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com' });
		});
	});

	describe('row validation', () => {
		test('validates rows against schema', async () => {
			const rows = await parseMockedCsv(
				'Name,Email\nAlice,alice@test.com\nBob,bob@test.com\n',
			);
			expect(rows).toHaveLength(2);
			expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com' });
			expect(rows[1]).toEqual({ Name: 'Bob', Email: 'bob@test.com' });
		});

		test('throws VALIDATION_FAILED for invalid rows', async () => {
			await expectCsvError('Name,Email\n,missing-name@test.com\n', 'VALIDATION_FAILED');
		});

		test('includes row numbers in validation errors', async () => {
			await expectCsvError(
				'Name,Email\nAlice,a@test.com\n,bad\n',
				'VALIDATION_FAILED',
				/Row 2/,
			);
		});

		test('applies defaults for optional fields', async () => {
			const rows = await parseMockedCsv('Name,Email\nAlice,\n');
			expect(rows[0]).toEqual({ Name: 'Alice', Email: '' });
		});
	});

	describe('csv parsing', () => {
		test('handles quoted fields with commas', async () => {
			const rows = await parseMockedCsv('Name,Email\n"Smith, John",john@test.com\n');
			expect(rows[0]).toEqual({ Name: 'Smith, John', Email: 'john@test.com' });
		});

		test('handles escaped double quotes', async () => {
			const rows = await parseMockedCsv(
				'Name,Email\n"She said ""hello""",test@test.com\n',
			);
			expect(rows[0]).toEqual({ Name: 'She said "hello"', Email: 'test@test.com' });
		});

		test('trims whitespace from fields', async () => {
			const rows = await parseMockedCsv('Name , Email\n  Alice  , alice@test.com  \n');
			expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com' });
		});

		test('handles quoted fields with newlines', async () => {
			const rows = await parseMockedCsv('Name,Email\n"Line 1\nLine 2",test@test.com\n');
			expect(rows[0]).toEqual({ Name: 'Line 1\nLine 2', Email: 'test@test.com' });
		});

		test('throws PARSE_ERROR for malformed CSV', async () => {
			await expectCsvError(
				'Name,Email\n"Unclosed quote,test@test.com\n',
				'PARSE_ERROR',
			);
		});

		test('handles multiple rows', async () => {
			const rows = await parseMockedCsv(
				'Name,Email\nAlice,a@test.com\nBob,b@test.com\nCharlie,c@test.com\n',
			);
			expect(rows).toHaveLength(3);
		});
	});
});

describe('CsvError', () => {
	test('is an instance of Error', () => {
		const error = new CsvError('EMPTY_CSV', 'No data');
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(CsvError);
	});

	test('has name, code, and message', () => {
		const error = new CsvError('MISSING_HEADERS', 'Missing: Name');
		expect(error.name).toBe('CsvError');
		expect(error.code).toBe('MISSING_HEADERS');
		expect(error.message).toBe('Missing: Name');
	});

	test('supports cause option', () => {
		const cause = new Error('original');
		const error = new CsvError('FETCH_FAILED', 'Failed', { cause });
		expect(error.cause).toBe(cause);
	});
});
