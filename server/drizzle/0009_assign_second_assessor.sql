-- The second assessor gets the same two columns as the first, added in 0007. Null until the
-- first assessment is submitted and the report reaches awaiting_second_assessor -- nothing
-- chooses this column at intake, unlike assessor1_user_id.
--
-- NO ACTION on delete, matching assessor1_user_id and entered_by_user_id: neither column may be
-- silently emptied by a user row going away.
--
-- GRANT UPDATE on these two columns only. The application role already has UPDATE ("status") from
-- 0008; that grant is not repeated here. assessor1_user_id and assessor1_assigned_at stay
-- ungranted -- nothing in this migration gives a route write access to who the first assessor is.

ALTER TABLE "reports" ADD COLUMN "assessor2_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "assessor2_assigned_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "reports" ADD CONSTRAINT "reports_assessor2_user_id_users_id_fk" FOREIGN KEY ("assessor2_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Serves the same workload count as reports_assessor1_status_idx, for the second assessor.
CREATE INDEX "reports_assessor2_status_idx" ON "reports" USING btree ("assessor2_user_id","status");--> statement-breakpoint

GRANT UPDATE ("assessor2_user_id", "assessor2_assigned_at") ON TABLE "reports" TO "ereports_app";