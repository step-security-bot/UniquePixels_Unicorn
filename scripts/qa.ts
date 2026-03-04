/**
 * Interactive QA runner with compact summary and expandable output.
 *
 * Runs all quality checks (format, lint, typecheck, test, coverage) sequentially,
 * captures output, and displays a color-coded summary. In TTY mode, provides an
 * interactive viewer to expand/collapse step output. In CI/piped mode, prints
 * the summary and any failed output, then exits.
 */

import process from 'node:process';

// ── ANSI helpers ──

const isTTY = process.stdout.isTTY ?? false;

const green = (t: string) => (isTTY ? `\x1b[32m${t}\x1b[0m` : t);
const red = (t: string) => (isTTY ? `\x1b[31m${t}\x1b[0m` : t);
const dim = (t: string) => (isTTY ? `\x1b[2m${t}\x1b[0m` : t);
const bold = (t: string) => (isTTY ? `\x1b[1m${t}\x1b[0m` : t);
const inverse = (t: string) => (isTTY ? `\x1b[7m${t}\x1b[0m` : `> ${t}`);

const CLEAR_LINE = '\x1b[2K\r';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ── Summary extraction patterns ──

const RE_FIXED_FILES = /Fixed (\d+) file/;
const RE_FORMATTED_FILES = /Formatted (\d+) file/;
const RE_CHECKED_FILES = /Checked (\d+) file/;
const RE_FOUND_ERRORS = /Found (\d+) error/;
const RE_TEST_PASS = /(\d+) pass/;
const RE_TEST_FAIL = /(\d+) fail/;
const RE_UNCOVERED = /(\d+) source file/;

// ── Step definitions ──

interface StepResult {
	name: string;
	passed: boolean;
	summary: string;
	output: string;
	expanded: boolean;
}

interface StepDef {
	name: string;
	cmd: string[];
	summarize: (output: string, code: number) => string;
}

const steps: StepDef[] = [
	{
		name: 'Format',
		cmd: ['bun', 'qa:format'],
		summarize: (out, code) => {
			if (code !== 0) {
				return 'failed';
			}
			const fixed = out.match(RE_FIXED_FILES);
			if (fixed) {
				return `fixed ${fixed[1]} file(s)`;
			}
			const formatted = out.match(RE_FORMATTED_FILES);
			return formatted ? `${formatted[1]} files` : '';
		},
	},
	{
		name: 'Lint',
		cmd: ['bun', 'qa:lint'],
		summarize: (out, code) => {
			if (code === 0) {
				const checked = out.match(RE_CHECKED_FILES);
				return checked ? `${checked[1]} files` : '';
			}
			const errors = out.match(RE_FOUND_ERRORS);
			return errors ? `${errors[1]} error(s)` : 'failed';
		},
	},
	{
		name: 'Type Check',
		cmd: ['bun', 'qa:tsc'],
		summarize: (out, code) => {
			if (code === 0) {
				return '';
			}
			const lines = out.trim().split('\n').filter(Boolean);
			const errorCount = lines.filter((l) => l.includes('error TS')).length;
			return errorCount > 0 ? `${errorCount} error(s)` : 'failed';
		},
	},
	{
		name: 'Test',
		cmd: ['bun', 'test'],
		summarize: (out, code) => {
			const pass = out.match(RE_TEST_PASS);
			const fail = out.match(RE_TEST_FAIL);
			const parts: string[] = [];
			if (pass) {
				parts.push(`${pass[1]} passed`);
			}
			if (fail && fail[1] !== '0') {
				parts.push(`${fail[1]} failed`);
			}
			if (parts.length > 0) {
				return parts.join(', ');
			}
			return code === 0 ? '' : 'failed';
		},
	},
	{
		name: 'Coverage',
		cmd: ['bun', 'scripts/check-coverage.ts'],
		summarize: (out, code) => {
			if (code === 0) {
				if (out.includes('All source files')) {
					return 'all files covered';
				}
				return '';
			}
			const uncovered = out.match(RE_UNCOVERED);
			return uncovered ? `${uncovered[1]} file(s) uncovered` : 'failed';
		},
	},
];

// ── Run steps ──

/** Runs a command and captures combined stdout+stderr. */
async function runStep(def: StepDef): Promise<StepResult> {
	const proc = Bun.spawn(def.cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	const output = `${stdout}${stderr}`.trim();

	return {
		name: def.name,
		passed: code === 0,
		summary: def.summarize(output, code),
		output,
		expanded: false,
	};
}

// ── Display ──

/** Formats a single result line. */
function formatLine(result: StepResult, selected: boolean): string {
	const icon = result.passed ? green('✓') : red('✗');
	const name = result.passed ? result.name : red(result.name);
	const summary = result.summary ? dim(result.summary) : '';
	const expand = result.expanded ? '▼' : '▶';
	const marker = selected ? inverse(` ${icon} ${name} `) : ` ${icon} ${name} `;
	const padding = ' '.repeat(Math.max(0, 18 - result.name.length));
	return `${marker}${padding}${summary} ${dim(expand)}`;
}

/** Renders the full interactive view. */
function render(results: StepResult[], cursor: number, passed: boolean): void {
	// Move cursor to top of our output area
	process.stdout.write(`\x1b[${results.length + 2}A`);

	for (const [i, step] of results.entries()) {
		process.stdout.write(`${CLEAR_LINE}${formatLine(step, i === cursor)}\n`);
		if (step.expanded && step.output) {
			for (const line of step.output.split('\n')) {
				process.stdout.write(`${CLEAR_LINE}${dim('  │ ')}${line}\n`);
			}
		}
	}

	const status = passed
		? green(bold('All checks passed'))
		: red(bold('Some checks failed'));
	process.stdout.write(`${CLEAR_LINE}\n`);
	process.stdout.write(
		`${CLEAR_LINE} ${status}  ${dim('↑↓ navigate · enter expand · q quit')}\n`,
	);
}

// ── Phases ──

/** Phase 1: Run all steps, show spinner in TTY mode. */
async function runAllSteps(): Promise<StepResult[]> {
	const stepResults: StepResult[] = [];

	for (const step of steps) {
		if (isTTY) {
			let frame = 0;
			const spinner = setInterval(() => {
				const icon = dim(SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? '⠋');
				process.stdout.write(`${CLEAR_LINE} ${icon} ${step.name}...`);
				frame++;
			}, 80);

			// biome-ignore lint/performance/noAwaitInLoops: steps must run sequentially with per-step spinner
			const result = await runStep(step);
			clearInterval(spinner);
			stepResults.push(result);

			process.stdout.write(`${CLEAR_LINE}${formatLine(result, false)}\n`);
		} else {
			const result = await runStep(step);
			stepResults.push(result);
		}
	}

	return stepResults;
}

/** Non-TTY: print summary and failed output, then exit. */
function printAndExit(results: StepResult[], passed: boolean): never {
	for (const result of results) {
		const icon = result.passed ? '✓' : '✗';
		const summary = result.summary ? `  ${result.summary}` : '';
		const padding = ' '.repeat(Math.max(0, 18 - result.name.length));
		// biome-ignore lint/suspicious/noConsole: CLI script output
		console.log(` ${icon} ${result.name}${padding}${summary}`);
	}
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log('');

	for (const result of results) {
		if (!result.passed && result.output) {
			const separator = '─'.repeat(Math.max(0, 60 - result.name.length));
			// biome-ignore lint/suspicious/noConsole: CLI script output
			console.log(`── ${result.name} ${separator}`);
			// biome-ignore lint/suspicious/noConsole: CLI script output
			console.log(result.output);
			// biome-ignore lint/suspicious/noConsole: CLI script output
			console.log('');
		}
	}

	process.exit(passed ? 0 : 1);
}

/** Handles a single keypress in interactive mode. */
function handleKey(
	key: string,
	state: { cursor: number },
	results: StepResult[],
	passed: boolean,
): void {
	if (key === 'q' || key === '\x03') {
		process.stdout.write(SHOW_CURSOR);
		process.stdin.setRawMode(false);
		process.exit(passed ? 0 : 1);
	}

	if (key === '\x1b[A') {
		state.cursor = Math.max(0, state.cursor - 1);
		render(results, state.cursor, passed);
	}

	if (key === '\x1b[B') {
		state.cursor = Math.min(results.length - 1, state.cursor + 1);
		render(results, state.cursor, passed);
	}

	if (key === '\r' || key === ' ') {
		const selected = results[state.cursor];
		if (selected) {
			selected.expanded = !selected.expanded;
			process.stdout.write('\x1b[J');
			render(results, state.cursor, passed);
		}
	}
}

/** TTY: interactive viewer with expand/collapse. */
function startInteractive(results: StepResult[], passed: boolean): void {
	process.stdout.write(HIDE_CURSOR);

	const status = passed
		? green(bold('All checks passed'))
		: red(bold('Some checks failed'));
	process.stdout.write(
		`\n ${status}  ${dim('↑↓ navigate · enter expand · q quit')}\n`,
	);

	const state = { cursor: 0 };
	render(results, state.cursor, passed);

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on('data', (data: Buffer) => {
		handleKey(data.toString(), state, results, passed);
	});
}

// ── Main ──

async function main(): Promise<void> {
	const results = await runAllSteps();
	const passed = results.every((r) => r.passed);

	if (isTTY) {
		startInteractive(results, passed);
	} else {
		printAndExit(results, passed);
	}
}

await main();
