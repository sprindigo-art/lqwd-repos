CREATE TABLE "chain_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"blocks" bigint,
	"headers" bigint,
	"verification_progress" numeric,
	"ibd" boolean,
	"size_on_disk_bytes" bigint,
	"peer_count" integer,
	"peers_in" integer,
	"peers_out" integer,
	"mempool_tx_count" integer,
	"mempool_bytes" bigint,
	"mempool_min_fee" numeric
);
--> statement-breakpoint
CREATE TABLE "host_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"cpu_pct" numeric,
	"load_1" numeric,
	"load_5" numeric,
	"load_15" numeric,
	"mem_total_kb" bigint,
	"mem_available_kb" bigint,
	"swap_total_kb" bigint,
	"swap_free_kb" bigint,
	"uptime_seconds" bigint,
	"net_rx_bytes" bigint,
	"net_tx_bytes" bigint
);
--> statement-breakpoint
CREATE TABLE "host_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"mount_point" text,
	"total_bytes" bigint,
	"used_bytes" bigint,
	"avail_bytes" bigint
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"host_id" text PRIMARY KEY NOT NULL,
	"hostname" text,
	"node_pubkeys" text[],
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"service_name" text,
	"node_pubkey" text,
	"collected_at" timestamp with time zone NOT NULL,
	"running" boolean,
	"functioning" boolean,
	"last_success_at" timestamp with time zone,
	"last_artifact_mtime" timestamp with time zone,
	"error_count" integer,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "service_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text,
	"service_name" text,
	"node_pubkey" text,
	"detection_method" text,
	"running_target" text,
	"artifact_path" text,
	"success_pattern" text,
	"error_pattern" text,
	"expected_interval_seconds" integer,
	"is_expected" boolean
);
--> statement-breakpoint
CREATE INDEX "chain_telemetry_host_collected_idx" ON "chain_telemetry" USING btree ("host_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chain_telemetry_collected_idx" ON "chain_telemetry" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "host_metrics_host_collected_idx" ON "host_metrics" USING btree ("host_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "host_metrics_collected_idx" ON "host_metrics" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "host_storage_host_mount_collected_idx" ON "host_storage" USING btree ("host_id","mount_point","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "host_storage_collected_idx" ON "host_storage" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "service_health_host_service_collected_idx" ON "service_health" USING btree ("host_id","service_name","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_health_collected_idx" ON "service_health" USING btree ("collected_at");