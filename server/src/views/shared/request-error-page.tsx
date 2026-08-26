import { BrandMark } from "./brand-mark.js";
import { Layout } from "./layout.js";

export type RequestErrorPageProps = {
  heading?: string;
  message?: string;
  title?: string;
};

const DEFAULT_TITLE = "Something went wrong — AE Reports";
const DEFAULT_HEADING = "Something went wrong";
const DEFAULT_MESSAGE = "Please try again later.";

export function RequestErrorPage({
  heading = DEFAULT_HEADING,
  message = DEFAULT_MESSAGE,
  title = DEFAULT_TITLE,
}: RequestErrorPageProps): JSX.Element {
  return (
    <Layout title={title} locale="en" bodyClass="staff-login">
      <div class="login-card">
        <div class="login-header">
          <BrandMark />
          <h1>{heading}</h1>
        </div>

        <div class="alert alert-error" safe>
          {message}
        </div>
      </div>
    </Layout>
  );
}
