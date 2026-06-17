CREATE TABLE `json_documents` (
	`id` text NOT NULL,
	`site` text NOT NULL,
	`collection` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`site`, `collection`, `id`)
);
--> statement-breakpoint
CREATE INDEX `json_documents_site_collection_idx` ON `json_documents` (`site`,`collection`);