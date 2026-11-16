CREATE TABLE `conversation_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`start_message_id` text NOT NULL,
	`end_message_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`start_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`end_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conversation_summaries_status_enum" CHECK("conversation_summaries"."status" IN ('pending', 'ready', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `conversation_summaries_conversation_idx` ON `conversation_summaries` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `conversation_summaries_agent_idx` ON `conversation_summaries` (`agent_id`,`status`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`source_message_id` text NOT NULL,
	`confidence` real NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`memory_pad` text NOT NULL,
	`arousal` real DEFAULT 0 NOT NULL,
	`half_life_hours` real NOT NULL,
	`strength` real DEFAULT 1 NOT NULL,
	`is_core` integer DEFAULT false NOT NULL,
	`last_accessed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "memories_type_enum" CHECK("memories"."type" IN ('fact', 'preference', 'goal', 'episode', 'relationship')),
	CONSTRAINT "memories_status_enum" CHECK("memories"."status" IN ('candidate', 'active', 'outdated', 'rejected', 'deleted')),
	CONSTRAINT "memories_confidence_range" CHECK("memories"."confidence" >= 0 AND "memories"."confidence" <= 1),
	CONSTRAINT "memories_arousal_range" CHECK("memories"."arousal" >= 0 AND "memories"."arousal" <= 1),
	CONSTRAINT "memories_strength_range" CHECK("memories"."strength" >= 0 AND "memories"."strength" <= 1),
	CONSTRAINT "memories_half_life_positive" CHECK("memories"."half_life_hours" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_source_content_unique` ON `memories` (`source_message_id`,lower("content"));--> statement-breakpoint
CREATE INDEX `memories_owner_status_idx` ON `memories` (`user_id`,`agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `memories_owner_type_idx` ON `memories` (`user_id`,`agent_id`,`type`);--> statement-breakpoint
CREATE INDEX `memories_source_message_idx` ON `memories` (`source_message_id`);