import postgres from "postgres";
import { hashPassword } from "./src/auth/password.ts";

const email = "register-ui-verify@tmda.go.tz";
const password = process.argv[2];
if (!password) {
  console.error("missing password");
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const hash = await hashPassword(password);
await sql`
  update users
  set password_hash = ${hash}, must_change_password = false
  where email = ${email}
`;
console.log("updated");
await sql.end();
