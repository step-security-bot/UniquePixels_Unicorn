// biome-ignore lint/style/noExportedImports: re-export pattern for Sentry initialization side effect
import * as Sentry from '@sentry/bun';

const isDev: boolean = Bun.env.NODE_ENV === 'development';

if (!isDev && Bun.env['sentryDSN']) {
	Sentry.init({
		dsn: Bun.env['sentryDSN'],
		debug: true,
		enableLogs: true,
		sendDefaultPii: true,
		environment: Bun.env.NODE_ENV ?? 'production',
	});
}

export { Sentry };
