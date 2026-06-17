CREATE TABLE `sites` (
	`name` text PRIMARY KEY NOT NULL,
	`last_deployed_at` text NOT NULL,
	`last_deployed_by_id` text NOT NULL,
	`last_deployed_by_email` text,
	`last_deployed_by_name` text,
	`file_count` integer NOT NULL
);
