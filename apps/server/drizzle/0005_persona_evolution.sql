CREATE TABLE `persona_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`request_text` text NOT NULL,
	`patch_json` text NOT NULL,
	`diff_summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'user_request' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_proposals_status_enum" CHECK("persona_proposals"."status" IN ('pending', 'approved', 'rejected', 'expired')),
	CONSTRAINT "persona_proposals_source_enum" CHECK("persona_proposals"."source" IN ('user_request', 'system_observed', 'rollback')),
	CONSTRAINT "persona_proposals_base_version_min" CHECK("persona_proposals"."base_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `persona_proposals_agent_status_idx` ON `persona_proposals` (`agent_id`,`status`);
--> statement-breakpoint
CREATE INDEX `persona_proposals_agent_created_idx` ON `persona_proposals` (`agent_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `prompt_snapshots` ADD `persona_version` integer;
