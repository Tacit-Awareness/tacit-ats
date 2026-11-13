import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AuthFrame, CompanyPicker, ConnectorConsent, ForgotPassword, LinkExpired, SetPassword, SignIn, authThemeScript, errorMessage } from "./index";

const noop = async () => {};

describe("AuthFrame", () => {
  test("names the product and draws only the links it is given", () => {
    const html = renderToStaticMarkup(<AuthFrame product="ATS" homeHref="/client"><p>x</p></AuthFrame>);
    expect(html).toContain('class="tacit-auth"');
    expect(html).toContain('aria-label="Tacit ATS"');
    expect(html).toContain('href="/client"');
    expect(html).not.toContain("auth-switch");
    expect(html).not.toContain('aria-label="Legal"');
  });

  test("testbench's switch and footer links", () => {
    const html = renderToStaticMarkup(
      <AuthFrame product="Testbench Staff" switchLink={{ prompt: "Taking an assessment?", label: "Candidate sign-in", href: "/candidate/login" }} footerLinks={[{ label: "Documentation", href: "/docs" }, { label: "Privacy", href: "/docs/privacy" }]}><p>x</p></AuthFrame>,
    );
    expect(html).toContain('<span class="auth-switch-ask">Taking an assessment?</span><a href="/candidate/login">Candidate sign-in</a>');
    expect(html).toContain('<nav aria-label="Legal"><a href="/docs">Documentation</a><a href="/docs/privacy">Privacy</a></nav>');
  });
});

describe("screens", () => {
  test("sign-in shows forgot password and the demo only when asked", () => {
    const plain = renderToStaticMarkup(<SignIn onSignIn={noop} redirectTo="/" />);
    expect(plain).toContain(">Sign in</h1>");
    expect(plain).not.toContain("auth-forgot");
    expect(plain).not.toContain("auth-or");
    const full = renderToStaticMarkup(<SignIn title="Staff sign-in" onSignIn={noop} redirectTo="/" forgotPasswordHref="/forgot" demo={{ label: "Explore the demo", busyLabel: "Opening", credentials: { email: "a@b.c", password: "x" } }} />);
    expect(full).toContain('href="/forgot"');
    expect(full).toContain("Explore the demo");
  });

  test("set password shows the address read-only", () => {
    const html = renderToStaticMarkup(<SetPassword email="a@b.co" onSetPassword={noop} redirectTo="/" />);
    expect(html).toMatch(/<input type="email" autoComplete="username" readOnly="" value="a@b.co"\/>/);
    expect(html).toContain("At least 8 characters");
  });

  test("company picker lists companies, or says there are none", () => {
    const html = renderToStaticMarkup(<CompanyPicker companies={[{ id: "1", name: "tacit Test Co", slug: "tacit-test-co" }]} onPick={noop} redirectTo="/" />);
    expect(html).toContain('<span class="auth-org-glyph" aria-hidden="true">T</span>');
    expect(html).toContain("tacit-test-co");
    const empty = renderToStaticMarkup(<CompanyPicker companies={[]} onPick={noop} redirectTo="/" />);
    expect(empty).toContain("No company yet");
    expect(empty).not.toContain("auth-orgs");
  });

  test("consent: missing link, sign-in, then the request", () => {
    const decide = async () => ({ redirectUrl: "/" });
    const permission = { title: "Read", description: "Reads." };
    expect(renderToStaticMarkup(<ConnectorConsent authorizationId={null} onDecide={decide} permission={permission} />)).toContain("Connection link incomplete");
    expect(renderToStaticMarkup(<ConnectorConsent authorizationId="x" onDecide={decide} permission={permission} />)).toContain("Connect an AI app");
    const request = { user: { email: "a@b.co" }, client: { name: "Claude" }, redirectUri: null };
    const html = renderToStaticMarkup(<ConnectorConsent authorizationId="x" request={request} onDecide={decide} permission={permission} />);
    expect(html).toContain("Allow Claude?");
    expect(html).not.toContain("You will return to");
  });

  test("forgot password and an expired link", () => {
    expect(renderToStaticMarkup(<ForgotPassword onRequestReset={noop} signInHref="/in" />)).toContain('href="/in"');
    expect(renderToStaticMarkup(<LinkExpired forgotPasswordHref="/f" signInHref="/in" />)).toContain('href="/f"');
  });
});

test("errorMessage", () => {
  expect(errorMessage(new Error("Nope"))).toBe("Nope");
  expect(errorMessage("Nope")).toBe("Nope");
  expect(errorMessage(undefined)).toBe("Something went wrong. Try again.");
});

test("the theme script quotes its key", () => {
  expect(authThemeScript("a'b")).toContain(`localStorage.getItem("a'b")`);
});
