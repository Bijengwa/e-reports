-- The one thing migration 0012 left undone: the assignments that already existed when the
-- A2..An generalization landed.
--
-- Before 0012 a manager named the second assessor by writing `reports.assessor2_user_id` and
-- setting the status; the `assessments` row appeared lazily, only once that Officer saved a first
-- draft. After 0012 `assign-next-assessor` writes the row eagerly, in the same transaction as the
-- status. 0012 changed how new assignments are recorded and left the old ones as they were, so a
-- report assigned before it and not yet opened by its assessor sits in `second_assessment` with
-- nothing in `assessments` above ordinal 1.
--
-- Three of the five places that ask "who is this report with?" compensate by reading the legacy
-- column -- `loadReport`, the report page's `mySecondaryOrdinal`, and `resolveMine`, which is why
-- the assessor can still open the form. The other two do not: the manager's Workload names the
-- current secondary assessor from `assessments`, and the Officer's own "Secondary assessments"
-- queue lists from the same place. The result is an assignment that exists, that its assessor can
-- work on by direct link, and that neither of them can see in the queue meant to show it to them.
--
-- Backfilling is the fix rather than a fourth and fifth fallback, because nothing writes
-- `assessor2_user_id` any more: the set of affected reports is closed, so repairing it once makes
-- every surface agree permanently instead of teaching two more queries to read a column the
-- application has stopped using.
--
-- Data only. No table, column, type or grant is touched.

INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload)
SELECT r.id,
       r.assessor2_user_id,
       -- Whatever comes next for this report, not a hard-coded 2. The rows this repairs are all
       -- at ordinal 2 in practice, but the ordinal is a fact about the report, and reading it is
       -- what makes that true rather than assumed.
       (SELECT coalesce(max(a.ordinal), 1) + 1 FROM assessments a WHERE a.report_id = r.id),
       'TMDA/DMD/MDV/F/004 Rev 05',
       '{}'::jsonb
  FROM reports r
 WHERE r.status = 'second_assessment'
   AND r.assessor2_user_id IS NOT NULL
   -- Only a report whose assessor never opened it. One that did already has its row, written by
   -- the upsert in the secondary-assessment route, and re-creating it is not possible anyway:
   -- (report_id, ordinal) is unique.
   AND NOT EXISTS (
     SELECT 1 FROM assessments a WHERE a.report_id = r.id AND a.ordinal > 1
   )
   -- "The second assessor must differ from the first" is a domain rule the schema cannot express,
   -- so it is asserted here rather than trusted. A legacy row naming the same Officer twice is
   -- left alone for a human to look at, not turned into a second assessment nobody may write.
   AND r.assessor2_user_id IS DISTINCT FROM r.assessor1_user_id
   -- An assessment is owed a first assessment to be a second one of. A report in this status
   -- without ordinal 1 is broken in a way this migration must not paper over.
   AND EXISTS (
     SELECT 1 FROM assessments a WHERE a.report_id = r.id AND a.ordinal = 1
   );
