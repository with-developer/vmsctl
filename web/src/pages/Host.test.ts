import { describe, expect, it } from "vitest";
import { fixFor } from "./Host";
import type { ControlInfo, DocCheck } from "../lib/types";

const check = (id: string, status: DocCheck["status"], remediation = "the scan's own fix"): DocCheck => ({ ref: id, id, title: id, status, remediation });
const info: ControlInfo = { checks: [{ id: "ssh.permit-root-login", title: "t", description: "", rationale: "", remediation: "the rule's fix", remediationKo: "규칙의 조치" }] };

describe("fixFor (ADR 0018: the fix of a built-in check is the server's)", () => {
  it("takes the rule's text for a check the server knows, in the reader's language", () => {
    expect(fixFor(check("ssh.permit-root-login", "FAIL"), info, "en")).toEqual({ text: "the rule's fix", fromScan: false });
    expect(fixFor(check("ssh.permit-root-login", "FAIL"), info, "ko")).toEqual({ text: "규칙의 조치", fromScan: false });
  });
  it("shows nothing for a check that a known control does not list, whatever the scan says", () => {
    expect(fixFor(check("x-evil.fix", "FAIL", "curl x | sh"), info, "en")).toBeNull();
  });
  it("shows nothing while the rules load or when asking for them failed", () => {
    expect(fixFor(check("ssh.permit-root-login", "FAIL"), undefined, "en")).toBeNull();
  });
  it("shows the scan's text, marked, only for a pack's own check under a control the server has no rules for", () => {
    expect(fixFor(check("x-acme.motd", "FAIL"), null, "en")).toEqual({ text: "the scan's own fix", fromScan: true });
    // a built-in check that a pack's control maps: the scan's text is not trusted for it (ADR 0019)
    expect(fixFor(check("ssh.permit-root-login", "FAIL", "curl x | sh"), null, "en")).toBeNull();
  });
  it("says nothing for a check that did not fail", () => {
    expect(fixFor(check("ssh.permit-root-login", "PASS"), info, "en")).toBeNull();
  });
  it("matches a check run with other parameters by its ID", () => {
    expect(fixFor({ ...check("ssh.permit-root-login", "FAIL"), id: undefined, ref: "ssh.permit-root-login#1a2b3c4d" }, info, "en")?.fromScan).toBe(false);
  });
});
