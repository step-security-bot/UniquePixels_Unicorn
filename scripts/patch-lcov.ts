/**
 * Patches coverage/lcov.info with 0-coverage entries for source files
 * not covered by any test. This ensures Codecov reports on ALL source
 * files, not just those imported during tests.
 *
 * Exclusion patterns are read from bunfig.toml `coveragePathIgnorePatterns`
 * (single source of truth), plus built-in excludes for test and declaration files.
 *
 * Files containing a `coverage-ignore-file` comment are also skipped.
 */

import process from 'node:process';

const LCOV_PATH = 'coverage/lcov.info';
const SOURCE_GLOB = 'src/**/*.ts';
const IGNORE_DIRECTIVE = 'coverage-ignore-file';

/** Built-in excludes that always apply (test files, declaration files). */
const BUILTIN_EXCLUDES = [/\.test\.ts$/, /\.d\.ts$/];

/** Converts a glob pattern to a RegExp for path matching. */
function globToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
		.replaceAll('**', '{{GLOBSTAR}}')
		.replaceAll('*', '[^/]*')
		.replaceAll('{{GLOBSTAR}}', '.*');
	return new RegExp(escaped);
}

/** Reads coveragePathIgnorePatterns from bunfig.toml. */
async function loadIgnorePatterns(): Promise<RegExp[]> {
	const bunfigFile = Bun.file('bunfig.toml');
	if (!(await bunfigFile.exists())) {
		return [];
	}

	const raw = await bunfigFile.text();
	const config = Bun.TOML.parse(raw) as Record<string, unknown>;
	const test = (config['test'] ?? {}) as Record<string, unknown>;
	const rawPatterns = test['coveragePathIgnorePatterns'];

	if (rawPatterns === undefined) {
		return [];
	}

	if (
		!(
			Array.isArray(rawPatterns) &&
			rawPatterns.every((item): item is string => typeof item === 'string')
		)
	) {
		throw new Error(
			'bunfig.toml: test.coveragePathIgnorePatterns must be an array of strings',
		);
	}

	return rawPatterns.map(globToRegex);
}

const configPatterns = await loadIgnorePatterns();
const EXCLUDE_PATTERNS = [...BUILTIN_EXCLUDES, ...configPatterns];

const lcovFile = Bun.file(LCOV_PATH);

if (!(await lcovFile.exists())) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.error(`${LCOV_PATH} not found. Run bun test first.`);
	process.exit(1);
}

const lcov = await lcovFile.text();

const coveredFiles = new Set(
	[...lcov.matchAll(/^SF:(.+)$/gm)].map((match) => match[1]),
);

const glob = new Bun.Glob(SOURCE_GLOB);
const sourceFiles: string[] = [];

for await (const file of glob.scan({ cwd: '.' })) {
	if (!EXCLUDE_PATTERNS.some((pattern) => pattern.test(file))) {
		sourceFiles.push(file);
	}
}

const untestedFiles = sourceFiles.filter((file) => !coveredFiles.has(file));

if (untestedFiles.length === 0) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log('All source files have test coverage.');
	process.exit(0);
}

const entries = await Promise.all(
	untestedFiles.map(async (file) => ({
		file,
		content: await Bun.file(file).text(),
	})),
);

const patchable = entries.filter(
	({ content }) => !content.includes(IGNORE_DIRECTIVE),
);

if (patchable.length === 0) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log('All source files have test coverage or are ignored.');
	process.exit(0);
}

let patch = '';

for (const { file, content } of patchable) {
	const lines = content.split('\n');
	patch += 'TN:\n';
	patch += `SF:${file}\n`;
	patch += 'FNF:0\n';
	patch += 'FNH:0\n';

	let lineCount = 0;
	for (const [i, line] of lines.entries()) {
		if (line.trim() !== '') {
			patch += `DA:${i + 1},0\n`;
			lineCount++;
		}
	}

	patch += `LF:${lineCount}\n`;
	patch += 'LH:0\n';
	patch += 'end_of_record\n';
}

const separator = lcov.endsWith('\n') ? '' : '\n';
await Bun.write(LCOV_PATH, lcov + separator + patch);

// biome-ignore lint/suspicious/noConsole: CLI script output
console.log(`Patched ${patchable.length} untested file(s) into ${LCOV_PATH}:`);
for (const { file } of patchable) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log(`  - ${file}`);
}
