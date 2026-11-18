CREATE TABLE `proactive_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`strategy` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "proactive_messages_strategy_enum" CHECK("proactive_messages"."strategy" IN ('emotion_care', 'memory_recall', 'curious_question'))
);
--> statement-breakpoint
CREATE INDEX `proactive_messages_agent_created_idx` ON `proactive_messages` (`agent_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `proactive_messages_conversation_idx` ON `proactive_messages` (`conversation_id`);
