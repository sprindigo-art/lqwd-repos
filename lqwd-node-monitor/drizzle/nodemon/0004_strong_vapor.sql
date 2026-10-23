CREATE TABLE "incident_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_key" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	"owner" text,
	"snooze_until" timestamp with time zone,
	"muted_at_severity" text,
	"muted_critical_children" integer,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "log_patterns_config" ADD COLUMN "category" text;--> statement-breakpoint
CREATE UNIQUE INDEX "incident_tracking_active_key_uniq" ON "incident_tracking" USING btree ("incident_key") WHERE cleared_at IS NULL;--> statement-breakpoint
CREATE INDEX "incident_tracking_key_idx" ON "incident_tracking" USING btree ("incident_key");