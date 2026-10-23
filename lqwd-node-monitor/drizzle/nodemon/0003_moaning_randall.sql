CREATE TABLE "host_cpu_core" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"core_index" integer,
	"user_jiffies" bigint,
	"nice_jiffies" bigint,
	"system_jiffies" bigint,
	"idle_jiffies" bigint,
	"iowait_jiffies" bigint,
	"irq_jiffies" bigint,
	"softirq_jiffies" bigint,
	"steal_jiffies" bigint,
	"guest_jiffies" bigint
);
--> statement-breakpoint
CREATE TABLE "host_disk_io" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"device" text,
	"reads_completed" bigint,
	"sectors_read" bigint,
	"writes_completed" bigint,
	"sectors_written" bigint,
	"ios_in_progress" bigint,
	"ms_doing_io" bigint
);
--> statement-breakpoint
CREATE TABLE "host_metrics_ext" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"ctxt" bigint,
	"intr" bigint,
	"cached_kb" bigint,
	"buffers_kb" bigint,
	"dirty_kb" bigint,
	"writeback_kb" bigint,
	"slab_kb" bigint,
	"sreclaimable_kb" bigint,
	"pgfault" bigint,
	"pgmajfault" bigint,
	"pswpin" bigint,
	"pswpout" bigint,
	"oom_kill" bigint,
	"tcp_retrans_segs" bigint,
	"tcp_out_segs" bigint,
	"tcp_in_segs" bigint,
	"tcp_active_opens" bigint,
	"tcp_attempt_fails" bigint,
	"sockets_total" integer,
	"tcp_estab" integer,
	"tcp_time_wait" integer,
	"fd_allocated" bigint,
	"fd_max" bigint,
	"procs_running" integer,
	"procs_blocked" integer,
	"failed_units_count" integer,
	"clock_offset_seconds" numeric,
	"nproc" integer,
	"entropy_avail" integer,
	"btime" bigint
);
--> statement-breakpoint
CREATE TABLE "host_net_iface" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"iface" text,
	"rx_bytes" bigint,
	"rx_errs" bigint,
	"rx_drop" bigint,
	"tx_bytes" bigint,
	"tx_errs" bigint,
	"tx_drop" bigint,
	"tx_colls" bigint
);
--> statement-breakpoint
CREATE TABLE "log_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"signature" text NOT NULL,
	"service_name" text,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"count_window" bigint,
	"sample_message" text,
	"classification" text,
	CONSTRAINT "log_patterns_host_signature_unique" UNIQUE("host_id","signature")
);
--> statement-breakpoint
CREATE TABLE "log_patterns_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_expression" text,
	"service" text,
	"level" text,
	"classification" text,
	"suppress" boolean,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "pg_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"datname" text,
	"max_connections" integer,
	"active_connections" integer,
	"numbackends" integer,
	"xact_commit" bigint,
	"xact_rollback" bigint,
	"deadlocks" bigint,
	"too_many_clients_count" bigint,
	"serialization_40001_count" bigint,
	"fatal_count" bigint,
	"blocked_queries" integer,
	"slow_query_gt_1s" integer,
	"stats_reset" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_log_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"service_name" text,
	"node_pubkey" text,
	"level" text,
	"message" text,
	"context_lines" text,
	"signature" text NOT NULL,
	"classification" text,
	"config_id" uuid,
	"source_path" text
);
--> statement-breakpoint
ALTER TABLE "host_storage" ADD COLUMN "inodes_total" bigint;--> statement-breakpoint
ALTER TABLE "host_storage" ADD COLUMN "inodes_used" bigint;--> statement-breakpoint
ALTER TABLE "host_storage" ADD COLUMN "inodes_free" bigint;--> statement-breakpoint
CREATE INDEX "host_cpu_core_host_core_collected_idx" ON "host_cpu_core" USING btree ("host_id","core_index","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "host_cpu_core_collected_idx" ON "host_cpu_core" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "host_disk_io_host_device_collected_idx" ON "host_disk_io" USING btree ("host_id","device","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "host_disk_io_collected_idx" ON "host_disk_io" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "host_metrics_ext_host_collected_idx" ON "host_metrics_ext" USING btree ("host_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "host_metrics_ext_collected_idx" ON "host_metrics_ext" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "host_net_iface_host_iface_collected_idx" ON "host_net_iface" USING btree ("host_id","iface","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "host_net_iface_collected_idx" ON "host_net_iface" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "log_patterns_host_last_seen_idx" ON "log_patterns" USING btree ("host_id","last_seen" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pg_health_host_collected_idx" ON "pg_health" USING btree ("host_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pg_health_collected_idx" ON "pg_health" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "service_log_events_host_collected_idx" ON "service_log_events" USING btree ("host_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_log_events_collected_idx" ON "service_log_events" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "service_log_events_host_signature_idx" ON "service_log_events" USING btree ("host_id","signature");