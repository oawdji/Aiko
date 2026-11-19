CREATE TABLE `diary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`mood_valence` real,
	`mood_arousal` real,
	`mood_dominance` real,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diary_entries_agent_date_idx` ON `diary_entries` (`agent_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `diary_entries_daily_unique` ON `diary_entries` (`agent_id`,`date`) WHERE type = 'daily';