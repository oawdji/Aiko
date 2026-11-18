CREATE TABLE `memories_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`source_message_id` text,
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
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "memories_type_enum" CHECK("memories_new"."type" IN ('fact', 'preference', 'goal', 'episode', 'relationship')),
	CONSTRAINT "memories_status_enum" CHECK("memories_new"."status" IN ('candidate', 'active', 'outdated', 'rejected', 'deleted')),
	CONSTRAINT "memories_confidence_range" CHECK("memories_new"."confidence" >= 0 AND "memories_new"."confidence" <= 1),
	CONSTRAINT "memories_arousal_range" CHECK("memories_new"."arousal" >= 0 AND "memories_new"."arousal" <= 1),
	CONSTRAINT "memories_strength_range" CHECK("memories_new"."strength" >= 0 AND "memories_new"."strength" <= 1),
	CONSTRAINT "memories_half_life_positive" CHECK("memories_new"."half_life_hours" > 0)
);
--> statement-breakpoint
INSERT INTO `memories_new` (`id`,`user_id`,`agent_id`,`type`,`content`,`source_message_id`,`confidence`,`status`,`memory_pad`,`arousal`,`half_life_hours`,`strength`,`is_core`,`last_accessed_at`,`created_at`,`updated_at`) SELECT `id`,`user_id`,`agent_id`,`type`,`content`,`source_message_id`,`confidence`,`status`,`memory_pad`,`arousal`,`half_life_hours`,`strength`,`is_core`,`last_accessed_at`,`created_at`,`updated_at` FROM `memories`;
--> statement-breakpoint
DROP TABLE `memories`;
--> statement-breakpoint
ALTER TABLE `memories_new` RENAME TO `memories`;
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_source_content_unique` ON `memories` (`source_message_id`,lower("content"));
--> statement-breakpoint
CREATE INDEX `memories_owner_status_idx` ON `memories` (`user_id`,`agent_id`,`status`);
--> statement-breakpoint
CREATE INDEX `memories_owner_type_idx` ON `memories` (`user_id`,`agent_id`,`type`);
--> statement-breakpoint
CREATE INDEX `memories_source_message_idx` ON `memories` (`source_message_id`);
