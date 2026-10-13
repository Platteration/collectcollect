import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginForm } from "@collectcollect/core/components/LoginForm";

/**
 * The login page as the server draws it: the password form only when there is
 * a password, the way to sign in with Google only when it is set up, a note
 * when it was asked for and does not hold, and the line a failed sign-in comes
 * back to.
 */
const draw = (props: Parameters<typeof LoginForm>[0]) => renderToStaticMarkup(createElement(LoginForm, props));
const HREF = "https://cards.example/api/auth/google/start?return=%2Fcollection";

describe("the login page", () => {
  it("is the password form alone when Google is not set up, as it always was", () => {
    const html = draw({ next: "/" });
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Google");
    expect(html).not.toContain("didn&#x27;t complete");
  });

  it("offers Google beside the password, as a link to start the sign-in", () => {
    const html = draw({ next: "/", google: { kind: "ready", href: HREF } });
    expect(html).toContain('type="password"');
    expect(html).toContain(`<a href="${HREF.replaceAll("&", "&amp;")}" class="btn-secondary w-full">Sign in with Google</a>`);
  });

  it("offers Google alone when there is no password, and no password field to type into", () => {
    const html = draw({ next: "/", passwordSet: false, google: { kind: "ready", href: HREF }, note: "This collection is private." });
    expect(html).not.toContain('type="password"');
    expect(html).toContain('class="btn-primary w-full">Sign in with Google</a>');
    expect(html).toContain("This collection is private.");
  });

  it("says so, without a link, when Google was asked for and does not hold", () => {
    const html = draw({ next: "/", passwordSet: false, google: { kind: "broken" } });
    expect(html).not.toContain("<a ");
    expect(html).toContain("Sign-in with Google is switched on but not fully set up");
  });

  it("says once that a sign-in with Google did not complete", () => {
    expect(draw({ next: "/", google: { kind: "ready", href: HREF }, signinFailed: true })).toContain("Sign-in didn&#x27;t complete.");
  });
});
