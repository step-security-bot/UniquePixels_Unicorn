/**
 * Checks that every source file is imported by at least one test.
 *
 * Bun's coverage threshold enforces 100% line coverage for files that ARE
 * imported, but it can't know about files that no test ever touches. This
 * script fills that gap by cross-referencing the lcov report against the
 * full set of source files.
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

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

const untestedFiles = sourceFiles.filter((file) => !coveredFiles.has(file));

if (untestedFiles.length === 0) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log(green('All source files have test coverage.'));
	process.exit(0);
}

const entries = await Promise.all(
	untestedFiles.map(async (file) => ({
		file,
		content: await Bun.file(file).text(),
	})),
);

const uncovered = entries.filter(
	({ content }) => !content.includes(IGNORE_DIRECTIVE),
);

if (uncovered.length === 0) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log(green('All source files have test coverage or are ignored.'));
	process.exit(0);
}

// biome-ignore lint/suspicious/noConsole: CLI script output
console.error(
	red(`\n${uncovered.length} source file(s) have no test coverage:\n`),
);
for (const { file } of uncovered) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.error(`  ${red('-')} ${file}`);
}
// biome-ignore lint/suspicious/noConsole: CLI script output
console.error(
	dim('\nEvery source file must be imported by at least one test.'),
	dim('\nAdd a test or include a `coverage-ignore-file` comment to opt out.\n'),
);
process.exit(1);
