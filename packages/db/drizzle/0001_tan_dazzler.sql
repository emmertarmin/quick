CREATE TABLE `openauth_kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `openauth_kv_expires_at_idx` ON `openauth_kv` (`expires_at`);