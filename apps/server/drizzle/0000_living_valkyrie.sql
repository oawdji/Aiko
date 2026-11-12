CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`current_valence` real NOT NULL,
	`current_arousal` real NOT NULL,
	`current_tag` text NOT NULL,
	`state_updated_at` text,
	`active_persona_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "agents_current_valence_range" CHECK("agents"."current_valence" >= -1 AND "agents"."current_valence" <= 1),
	CONSTRAINT "agents_current_arousal_range" CHECK("agents"."current_arousal" >= -1 AND "agents"."current_arousal" <= 1),
	CONSTRAINT "agents_current_tag_enum" CHECK("agents"."current_tag" IN ('calm', 'curious', 'happy', 'low', 'tense', 'neutral')),
	CONSTRAINT "agents_active_persona_version_min" CHECK("agents"."active_persona_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_unique` ON `agents` (`slug`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "app_settings_value_json_valid" CHECK(json_valid("app_settings"."value_json"))
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text,
	`last_message_at` text,
	`is_archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conversations_is_archived_flag" CHECK("conversations"."is_archived" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `conversations_agent_last_message_idx` ON `conversations` (`agent_id`,"last_message_at" desc);--> statement-breakpoint
CREATE INDEX `conversations_user_agent_idx` ON `conversations` (`user_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`client_message_id` text,
	`error_code` text,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "messages_role_enum" CHECK("messages"."role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "messages_status_enum" CHECK("messages"."status" IN ('streaming', 'complete', 'failed')),
	CONSTRAINT "messages_user_requires_client_message_id" CHECK("messages"."role" <> 'user' OR "messages"."client_message_id" IS NOT NULL),
	CONSTRAINT "messages_failed_requires_error_code" CHECK("messages"."status" <> 'failed' OR "messages"."error_code" IS NOT NULL),
	CONSTRAINT "messages_metadata_json_valid" CHECK("messages"."metadata_json" IS NULL OR json_valid("messages"."metadata_json"))
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_created_idx` ON `messages` (`conversation_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `messages_agent_created_idx` ON `messages` (`agent_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `messages_status_idx` ON `messages` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_client_message_unique` ON `messages` (`conversation_id`,`client_message_id`);--> statement-breakpoint
CREATE TABLE `state_events` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`trigger_message_id` text,
	`source` text NOT NULL,
	`rule_version` text NOT NULL,
	`before_valence` real NOT NULL,
	`before_arousal` real NOT NULL,
	`delta_valence` real NOT NULL,
	`delta_arousal` real NOT NULL,
	`after_valence` real NOT NULL,
	`after_arousal` real NOT NULL,
	`discrete_tag` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_text` text NOT NULL,
	`confidence` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trigger_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "state_events_source_enum" CHECK("state_events"."source" IN ('user_message', 'assistant_message', 'time_decay', 'manual')),
	CONSTRAINT "state_events_before_valence_range" CHECK("state_events"."before_valence" >= -1 AND "state_events"."before_valence" <= 1),
	CONSTRAINT "state_events_before_arousal_range" CHECK("state_events"."before_arousal" >= -1 AND "state_events"."before_arousal" <= 1),
	CONSTRAINT "state_events_delta_valence_range" CHECK("state_events"."delta_valence" >= -1 AND "state_events"."delta_valence" <= 1),
	CONSTRAINT "state_events_delta_arousal_range" CHECK("state_events"."delta_arousal" >= -1 AND "state_events"."delta_arousal" <= 1),
	CONSTRAINT "state_events_after_valence_range" CHECK("state_events"."after_valence" >= -1 AND "state_events"."after_valence" <= 1),
	CONSTRAINT "state_events_after_arousal_range" CHECK("state_events"."after_arousal" >= -1 AND "state_events"."after_arousal" <= 1),
	CONSTRAINT "state_events_confidence_range" CHECK("state_events"."confidence" >= 0 AND "state_events"."confidence" <= 1),
	CONSTRAINT "state_events_discrete_tag_enum" CHECK("state_events"."discrete_tag" IN ('calm', 'curious', 'happy', 'low', 'tense', 'neutral')),
	CONSTRAINT "state_events_message_trigger_required" CHECK("state_events"."source" NOT IN ('user_message', 'assistant_message') OR "state_events"."trigger_message_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `state_events_agent_created_idx` ON `state_events` (`agent_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `state_events_conversation_created_idx` ON `state_events` (`conversation_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `state_events_trigger_idx` ON `state_events` (`trigger_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `state_events_trigger_source_rule_unique` ON `state_events` (`trigger_message_id`,`source`,`rule_version`);--> statement-breakpoint
CREATE TABLE `persona_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`persona_core_md` text NOT NULL,
	`persona_core_hash` text NOT NULL,
	`evolvable_json` text NOT NULL,
	`is_active` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`activated_at` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "persona_versions_version_min" CHECK("persona_versions"."version" >= 1),
	CONSTRAINT "persona_versions_is_active_flag" CHECK("persona_versions"."is_active" IN (0, 1)),
	CONSTRAINT "persona_versions_evolvable_json_valid" CHECK(json_valid("persona_versions"."evolvable_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_versions_one_active_idx` ON `persona_versions` (`agent_id`) WHERE "persona_versions"."is_active" = 1;--> statement-breakpoint
CREATE INDEX `persona_versions_agent_version_idx` ON `persona_versions` (`agent_id`,"version" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `persona_versions_agent_version_unique` ON `persona_versions` (`agent_id`,`version`);