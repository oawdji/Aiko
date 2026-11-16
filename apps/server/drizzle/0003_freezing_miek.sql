CREATE TABLE `prompt_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`user_message_id` text,
	`system_text` text NOT NULL,
	`memory_ids_json` text DEFAULT '[]' NOT NULL,
	`recent_window_count` text DEFAULT '0' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_snapshots_conversation_idx` ON `prompt_snapshots` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `prompt_snapshots_created_idx` ON `prompt_snapshots` (`created_at`);