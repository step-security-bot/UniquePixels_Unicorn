// Guard narrowing utility (re-exported for convenience)
export type { NarrowedBy } from '@/core/guards';
export {
	type BaseCommandSpark,
	type CommandAction,
	type CommandBuilder,
	type CommandOptions,
	type CommandSpark,
	type CommandWithAutocompleteOptions,
	defineCommand,
	defineCommandWithAutocomplete,
	hasAutocomplete,
} from './command';
// Command groups (subcommands & subcommand groups)
export {
	type CommandGroupOptions,
	defineCommandGroup,
	type SubcommandHandler,
} from './command-group';
// Component sparks
export {
	type AnyComponentInteraction,
	type BaseComponentSpark,
	type ComponentAction,
	type ComponentInteraction,
	type ComponentOptions,
	type ComponentSpark,
	type CustomIdPattern,
	defineComponent,
	findComponentSpark,
	matchCustomId,
	type SelectMenuInteraction,
} from './component';
// Gateway event sparks
export {
	defineGatewayEvent,
	type GatewayEventAction,
	type GatewayEventOptions,
	type GatewayEventSpark,
	type ReadyClient,
} from './gateway-event';
// Loader
export {
	type AnySpark,
	collectCommandBuilders,
	type LoadSparksOptions,
	type LoadSparksResult,
	loadSparks,
	type SparkType,
} from './loader';
// Scheduled event sparks
export {
	defineScheduledEvent,
	type ScheduledAction,
	type ScheduledContext,
	type ScheduledEventOptions,
	type ScheduledEventSpark,
	stopAllScheduledJobs,
} from './scheduled-event';
