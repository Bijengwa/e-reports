-- 0022 granted SELECT, INSERT, DELETE but not UPDATE, on the assumption that a staging row is
-- never edited in place. That is still true, but `confirmImdrfImport` takes the row lock with
-- `SELECT ... FOR UPDATE` to serialize a concurrent double-confirm of the same token, and Postgres
-- requires the UPDATE privilege to acquire that lock even though no UPDATE statement is ever run.
-- Without it every confirm fails with "permission denied for table imdrf_import_staging".

GRANT UPDATE ON TABLE "imdrf_import_staging" TO "ereports_app";
