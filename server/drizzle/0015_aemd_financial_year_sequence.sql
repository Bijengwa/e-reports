-- Re-keys report_counters from one row per calendar year to one row per financial year
-- (1 July - 30 June, e.g. "2025-26"), backing AEMD/YYYY-YY/NNN report numbers instead of
-- MD-AE/YYYY/NNNN. The table only ever held working counter state, never a report's own number,
-- so its rows are cleared rather than migrated.
ALTER TABLE "report_counters" ADD COLUMN "fy" text;
--> statement-breakpoint
ALTER TABLE "report_counters" ADD COLUMN "last_serial" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DELETE FROM "report_counters";
--> statement-breakpoint
ALTER TABLE "report_counters" DROP CONSTRAINT "report_counters_pkey";
--> statement-breakpoint
ALTER TABLE "report_counters" DROP COLUMN "year";
--> statement-breakpoint
ALTER TABLE "report_counters" DROP COLUMN "issued";
--> statement-breakpoint
ALTER TABLE "report_counters" ALTER COLUMN "fy" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_counters" ADD CONSTRAINT "report_counters_pkey" PRIMARY KEY ("fy");
