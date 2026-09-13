-- IMDRF adverse-event terminology, Phase 1: two tables, no foreign key from anything that
-- existed before this migration into either of them. See `db/schema/index.ts` for the design
-- rationale (release lifecycle, hierarchy derivation, why annex is text and not an enum position).

CREATE TYPE "public"."imdrf_release_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "imdrf_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_year" smallint NOT NULL,
	"document_code" text,
	"title" text,
	"source_file_name" text NOT NULL,
	"status" "imdrf_release_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "imdrf_releases_release_year_unique" UNIQUE("release_year")
);--> statement-breakpoint
CREATE TABLE "imdrf_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"annex" text NOT NULL,
	"code" text NOT NULL,
	"term" text NOT NULL,
	"definition" text,
	"non_imdrf_code" text,
	"status" text,
	"status_description" text,
	"primary_category" text,
	"secondary_category" text,
	"code_hierarchy" text NOT NULL,
	"parent_term_id" uuid,
	"level" smallint NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imdrf_terms_annex_ck" CHECK (annex IN ('A','B','C','D','E','F','G'))
);--> statement-breakpoint
ALTER TABLE "imdrf_terms" ADD CONSTRAINT "imdrf_terms_release_id_imdrf_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."imdrf_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imdrf_terms" ADD CONSTRAINT "imdrf_terms_parent_term_id_imdrf_terms_id_fk" FOREIGN KEY ("parent_term_id") REFERENCES "public"."imdrf_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imdrf_terms_release_code_uq" ON "imdrf_terms" USING btree ("release_id","code");--> statement-breakpoint
CREATE INDEX "imdrf_terms_release_annex_sort_idx" ON "imdrf_terms" USING btree ("release_id","annex","sort_order");--> statement-breakpoint
CREATE INDEX "imdrf_terms_release_parent_idx" ON "imdrf_terms" USING btree ("release_id","parent_term_id");--> statement-breakpoint
CREATE INDEX "imdrf_terms_release_level_idx" ON "imdrf_terms" USING btree ("release_id","level");
