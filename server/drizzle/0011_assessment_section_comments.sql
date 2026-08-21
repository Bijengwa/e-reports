-- The manager's comments on individual sections of an assessment.
--
-- A table rather than more columns, which is the opposite of what 0010 decided and for the
-- opposite reason. 0010 stores one manager's one finding about a whole assessment, and one row can
-- hold one of those. This is many comments about many sections of the same assessment, so the
-- thing being stored is a list and a list is a table. The two are different records and both are
-- wanted: the overall review is the manager's verdict, and these are their notes in the margin.
--
-- Hung off `assessments.id` rather than off (report_id, ordinal). Those two already identify an
-- assessment through the unique index 0000 put on them, so naming the row directly says the same
-- thing in one column and removes the way a comment could name a report and an ordinal that do
-- not belong together. Which report a comment is about is a join away and is never stored twice.
--
-- ON DELETE CASCADE, matching `assessments` and `attachments` against `reports`: a comment is
-- about an assessment and has no meaning once that assessment is gone. That is not a licence to
-- delete assessments -- nothing has been granted DELETE on them, and 0008 said why.
--
-- `section` is text, not an enum or a smallint. Today the F004 exposes eight stable section
-- anchors and the route accepts exactly those eight; storing the key as text means commenting on
-- a sub-block such as 7.1 later is a change to what the route validates and not a migration of
-- everything already written. The column is deliberately not a foreign key: sections are part of
-- a form version, not rows.
--
-- `author_user_id` is NO ACTION on delete, matching every other user reference in the schema: a
-- comment must not lose its author because an account was removed.
--
-- There is no `updated_at` and no `deleted_at`. An assessment is a regulatory record and so is a
-- comment on one; editing and withdrawing are a different feature with a different audit story,
-- and the grant below withholds both until that feature exists and argues for them.
--
-- SELECT and INSERT only for the application role. Contrast 0008, which granted UPDATE on
-- assessments because a draft is saved repeatedly; nothing here is ever rewritten.

CREATE TABLE "assessment_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"section" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "assessment_comments" ADD CONSTRAINT "assessment_comments_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "assessment_comments" ADD CONSTRAINT "assessment_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Serves both reads this feature makes: the count beside every section bar, and the thread of one
-- section when it is opened. Both filter on the assessment first and the section second, and both
-- want the oldest comment first, which is the order the index already carries.
CREATE INDEX "assessment_comments_assessment_section_idx" ON "assessment_comments" USING btree ("assessment_id","section","created_at");--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE "assessment_comments" TO "ereports_app";
