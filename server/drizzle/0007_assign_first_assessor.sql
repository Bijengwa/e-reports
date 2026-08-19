-- Every report now names the Officer it is waiting on, chosen as it is filed.
--
-- Two nullable columns rather than one NOT NULL. Null is a real state -- no active assessor
-- existed when the report arrived -- and refusing a vigilance report because the office is
-- unstaffed would lose the report, which is worse than holding an unassigned one.
--
-- NO ACTION on delete, matching entered_by_user_id. Neither column may be silently emptied by a
-- user row going away, and this application deactivates accounts rather than deleting them.
--
-- assessments.ordinal = 1 names this same person once an F004 exists. Nothing writes that table
-- yet. Whatever does must read this column rather than choose again, or the two will disagree
-- about who assessor 1 is.
--
-- No GRANT here, deliberately. The application role holds INSERT on reports and not UPDATE; the
-- assignment is written by the insert that creates the report, so nothing new is needed. The
-- backfill below is an UPDATE and runs in this migration as the owner.

ALTER TABLE "reports" ADD COLUMN "assessor1_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "assessor1_assigned_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "reports" ADD CONSTRAINT "reports_assessor1_user_id_users_id_fk"
  FOREIGN KEY ("assessor1_user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Serves the workload count the assignment runs for every candidate on every intake.
CREATE INDEX "reports_assessor1_status_idx" ON "reports" ("assessor1_user_id","status");--> statement-breakpoint

-- Backfill: everything already waiting, shared out by the rule the application now applies.
--
-- One report at a time, oldest first, re-reading the workload after each. A set-based UPDATE
-- cannot do this: every row would be scored against the same starting counts and the whole
-- backlog would land on whoever happened to be least loaded at the start.
--
-- clock_timestamp() rather than now(), which is fixed for the whole transaction. The tie-break
-- reads these timestamps to find who has waited longest, and a backfill stamping them all
-- identically would leave that tie to the id for as long as the rows survive.
--
-- Only status = 'received'. A report already under assessment has a history this migration cannot
-- see, and inventing one for it would be worse than leaving it alone.
DO $$
DECLARE
  waiting uuid;
  chosen  uuid;
BEGIN
  FOR waiting IN
    SELECT id FROM reports
     WHERE status = 'received' AND assessor1_user_id IS NULL
     ORDER BY received_at ASC, number ASC
  LOOP
    SELECT u.id INTO chosen
      FROM users u
     WHERE u.role = 'assessor'
       AND u.is_active
     ORDER BY (
               SELECT count(*)
                 FROM reports r
                WHERE r.assessor1_user_id = u.id
                  AND r.status IN ('received', 'first_assessment')
             ) ASC,
             (
               SELECT max(r.assessor1_assigned_at)
                 FROM reports r
                WHERE r.assessor1_user_id = u.id
             ) ASC NULLS FIRST,
             u.id ASC
     LIMIT 1;

    -- No active assessor: this report, and every one after it, stays an orphan.
    EXIT WHEN chosen IS NULL;

    UPDATE reports
       SET assessor1_user_id = chosen,
           assessor1_assigned_at = clock_timestamp()
     WHERE id = waiting;
  END LOOP;
END $$;
