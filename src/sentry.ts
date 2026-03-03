// biome-ignore lint/style/noExportedImports: re-export pattern for Sentry initialization side effect
import * as Sentry from '@sentry/bun';
import { sentryPinoIntegration } from '@/core/lib/logger';

const isDev: boolean = Bun.env.NODE_ENV === 'development';

if (!isDev && Bun.env['sentryDSN']) {
	Sentry.init({
		dsn: Bun.env['sentryDSN'],
		debug: false,
		enableLogs: true,
		sendDefaultPii: true,
		environment: Bun.env.NODE_ENV ?? 'production',
		integrations: [sentryPinoIntegration()],
	});
}

export { Sentry };
