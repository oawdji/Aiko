PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`current_valence` real NOT NULL,
	`current_arousal` real NOT NULL,
	`current_dominance` real DEFAULT 0 NOT NULL,
	`baseline_valence` real DEFAULT 0 NOT NULL,
	`baseline_arousal` real DEFAULT 0 NOT NULL,
	`baseline_dominance` real DEFAULT 0 NOT NULL,
	`decay_half_life_hours` real,
	`current_tag` text NOT NULL,
	`state_updated_at` text,
	`active_persona_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "agents_current_valence_range" CHECK("__new_agents"."current_valence" >= -1 AND "__new_agents"."current_valence" <= 1),
	CONSTRAINT "agents_current_arousal_range" CHECK("__new_agents"."current_arousal" >= -1 AND "__new_agents"."current_arousal" <= 1),
	CONSTRAINT "agents_current_dominance_range" CHECK("__new_agents"."current_dominance" >= -1 AND "__new_agents"."current_dominance" <= 1),
	CONSTRAINT "agents_baseline_valence_range" CHECK("__new_agents"."baseline_valence" >= -1 AND "__new_agents"."baseline_valence" <= 1),
	CONSTRAINT "agents_baseline_arousal_range" CHECK("__new_agents"."baseline_arousal" >= -1 AND "__new_agents"."baseline_arousal" <= 1),
	CONSTRAINT "agents_baseline_dominance_range" CHECK("__new_agents"."baseline_dominance" >= -1 AND "__new_agents"."baseline_dominance" <= 1),
	CONSTRAINT "agents_decay_half_life_hours_positive" CHECK(("__new_agents"."decay_half_life_hours" IS NULL OR "__new_agents"."decay_half_life_hours" > 0)),
	CONSTRAINT "agents_current_tag_enum" CHECK("__new_agents"."current_tag" IN ('calm', 'curious', 'happy', 'low', 'tense', 'neutral')),
	CONSTRAINT "agents_active_persona_version_min" CHECK("__new_agents"."active_persona_version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "slug", "display_name", "description", "current_valence", "current_arousal", "current_dominance", "baseline_valence", "baseline_arousal", "baseline_dominance", "decay_half_life_hours", "current_tag", "state_updated_at", "active_persona_version", "created_at", "updated_at") SELECT "id", "slug", "display_name", "description", "current_valence", "current_arousal", 0, 0, 0, 0, NULL, "current_tag", "state_updated_at", "active_persona_version", "created_at", "updated_at" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_unique` ON `agents` (`slug`);--> statement-breakpoint
CREATE TABLE `__new_state_events` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`trigger_message_id` text,
	`source` text NOT NULL,
	`rule_version` text NOT NULL,
	`before_valence` real NOT NULL,
	`before_arousal` real NOT NULL,
	`before_dominance` real DEFAULT 0 NOT NULL,
	`delta_valence` real NOT NULL,
	`delta_arousal` real NOT NULL,
	`delta_dominance` real DEFAULT 0 NOT NULL,
	`after_valence` real NOT NULL,
	`after_arousal` real NOT NULL,
	`after_dominance` real DEFAULT 0 NOT NULL,
	`discrete_tag` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_text` text NOT NULL,
	`confidence` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trigger_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "state_events_source_enum" CHECK("__new_state_events"."source" IN ('user_message', 'assistant_message', 'time_decay', 'manual')),
	CONSTRAINT "state_events_before_valence_range" CHECK("__new_state_events"."before_valence" >= -1 AND "__new_state_events"."before_valence" <= 1),
	CONSTRAINT "state_events_before_arousal_range" CHECK("__new_state_events"."before_arousal" >= -1 AND "__new_state_events"."before_arousal" <= 1),
	CONSTRAINT "state_events_before_dominance_range" CHECK("__new_state_events"."before_dominance" >= -1 AND "__new_state_events"."before_dominance" <= 1),
	CONSTRAINT "state_events_delta_valence_range" CHECK("__new_state_events"."delta_valence" >= -1 AND "__new_state_events"."delta_valence" <= 1),
	CONSTRAINT "state_events_delta_arousal_range" CHECK("__new_state_events"."delta_arousal" >= -1 AND "__new_state_events"."delta_arousal" <= 1),
	CONSTRAINT "state_events_delta_dominance_range" CHECK("__new_state_events"."delta_dominance" >= -1 AND "__new_state_events"."delta_dominance" <= 1),
	CONSTRAINT "state_events_after_valence_range" CHECK("__new_state_events"."after_valence" >= -1 AND "__new_state_events"."after_valence" <= 1),
	CONSTRAINT "state_events_after_arousal_range" CHECK("__new_state_events"."after_arousal" >= -1 AND "__new_state_events"."after_arousal" <= 1),
	CONSTRAINT "state_events_after_dominance_range" CHECK("__new_state_events"."after_dominance" >= -1 AND "__new_state_events"."after_dominance" <= 1),
	CONSTRAINT "state_events_confidence_range" CHECK("__new_state_events"."confidence" >= 0 AND "__new_state_events"."confidence" <= 1),
	CONSTRAINT "state_events_discrete_tag_enum" CHECK("__new_state_events"."discrete_tag" IN ('calm', 'curious', 'happy', 'low', 'tense', 'neutral')),
	CONSTRAINT "state_events_message_trigger_required" CHECK("__new_state_events"."source" NOT IN ('user_message', 'assistant_message') OR "__new_state_events"."trigger_message_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_state_events`("id", "agent_id", "conversation_id", "trigger_message_id", "source", "rule_version", "before_valence", "before_arousal", "before_dominance", "delta_valence", "delta_arousal", "delta_dominance", "after_valence", "after_arousal", "after_dominance", "discrete_tag", "reason", "evidence_text", "confidence", "created_at") SELECT "id", "agent_id", "conversation_id", "trigger_message_id", "source", "rule_version", "before_valence", "before_arousal", 0, "delta_valence", "delta_arousal", 0, "after_valence", "after_arousal", 0, "discrete_tag", "reason", "evidence_text", "confidence", "created_at" FROM `state_events`;--> statement-breakpoint
DROP TABLE `state_events`;--> statement-breakpoint
ALTER TABLE `__new_state_events` RENAME TO `state_events`;--> statement-breakpoint
CREATE INDEX `state_events_agent_created_idx` ON `state_events` (`agent_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `state_events_conversation_created_idx` ON `state_events` (`conversation_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `state_events_trigger_idx` ON `state_events` (`trigger_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `state_events_trigger_source_rule_unique` ON `state_events` (`trigger_message_id`,`source`,`rule_version`);