CREATE TYPE "public"."decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('invoice_exception', 'purchase', 'access', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('requester', 'approver', 'admin', 'agent');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" "decision" NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_one_per_approver" UNIQUE("request_id","approver_id"),
	CONSTRAINT "approvals_rejection_has_comment" CHECK ("approvals"."decision" = 'approved' or char_length("approvals"."comment") > 0)
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_not_empty" CHECK (char_length("comments"."body") > 0)
);
--> statement-breakpoint
CREATE TABLE "request_tags" (
	"request_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "request_tags_request_id_tag_id_pk" PRIMARY KEY("request_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "request_type" NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_ref" text,
	"amount_minor" integer,
	"currency" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requester_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "requests_title_length" CHECK (char_length("requests"."title") between 3 and 200),
	CONSTRAINT "requests_amount_non_negative" CHECK ("requests"."amount_minor" >= 0),
	CONSTRAINT "requests_amount_has_currency" CHECK (("requests"."amount_minor" is null) = ("requests"."currency" is null)),
	CONSTRAINT "requests_decided_at_matches_status" CHECK (("requests"."status" = 'pending') = ("requests"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_name_lowercase" CHECK ("tags"."name" = lower("tags"."name"))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_tags" ADD CONSTRAINT "request_tags_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_tags" ADD CONSTRAINT "request_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_request_id" ON "comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_tags_tag_id" ON "request_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_pending_external_ref" ON "requests" USING btree ("source","external_ref") WHERE "requests"."status" = 'pending' and "requests"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "requests_status_created_at" ON "requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "requests_requester_id" ON "requests" USING btree ("requester_id");