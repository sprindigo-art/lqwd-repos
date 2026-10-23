CREATE TYPE "public"."command_state" AS ENUM('draft', 'pending_approval', 'approved', 'claimed', 'executing', 'succeeded', 'failed', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "command_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"stale_acknowledged" boolean DEFAULT false,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"executed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_pubkey" text NOT NULL,
	"action_type" text NOT NULL,
	"params" jsonb NOT NULL,
	"canonical_payload" text NOT NULL,
	"signature_hex" text NOT NULL,
	"state" "command_state" DEFAULT 'pending_approval' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_executions" ADD CONSTRAINT "command_executions_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;