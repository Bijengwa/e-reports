import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await sql`
  select email, full_name, role
  from users
  where is_active = true
  order by role, email
`;
console.log(rows.map((r) => `${r.role} | ${r.email} | ${r.full_name}`).join("\n"));
await sql.end();
