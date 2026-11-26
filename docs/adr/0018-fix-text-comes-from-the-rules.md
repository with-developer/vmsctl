# 0018. Fix text comes from the rules, not from a host; no shell commands in rules

- Status: Accepted
- Date: 2026-11-24

## Context

The remediation page (v0.47) shows how to fix a failing control next to the hosts that fail it. The next step proposed was
per-distribution fix commands: an optional `fix:` map in a check (`debian`, `rhel`) of shell commands, shown in `explain`,
the reports, the dashboard and the result document, proven by an e2e run that applies them to a stock container of each
supported distribution and scans it again.

A review against the proposal found it unsafe as written:

- **The trust path.** A result carries its fix text (`remediation`, `remediationKo`), the server stores it after checking
  only its length and that it is text, and the dashboard's evidence view shows it as it came. A host that is compromised,
  or anyone with its ingest token, can therefore put any text there, and the dashboard presents it as the project's
  guidance. Prose that misleads does little harm; a command that an administrator copies and runs as root on many hosts
  turns a compromised host into a compromised fleet, through a person. That is the outcome VISION principle 3 rules out.
  Policy packs are trusted like `vmsctl.yaml` (ADR 0012), not reviewed by the project.
- **The proof proves too little.** In a container, sysctl, service and kernel checks are NOT_APPLICABLE, so their commands
  pass untested. One run does not show that a command is idempotent (`sed -i '1i …'` adds a line every time), that it
  works alone, or that the host stays usable (`PasswordAuthentication no` without keys, a PAM stack rewritten by
  `authselect --force`, which drops sssd or MFA on a real host). `e2e/harden.sh` says it is not a hardening guide.
- **A family is not a platform.** CentOS 7, EL 9 and 10, and Amazon Linux 2023 already need different PAM steps; commands
  would grow shell conditions inside rules, which every rule reviewer would then have to review as code.
- **Parameters.** Checks with `params` take values from the profile and `vmsctl.yaml`; a command with a fixed value
  contradicts the policy the user set.
- **The non-goal.** VISION allows fix hints and rules out remediation. Commands grouped per family are a script in all but
  name; "copy all", "export" and "let the agent run it" follow.

## Decision

1. **No shell commands in rules.** The fix stays prose (`remediation`, `remediation_ko`), which names the setting, the file
   and the value, with short commands in backticks where one is exact (`chmod go-w`), as today.
2. **The dashboard shows the fix text of a built-in check from the server's own rules, never from the result.** The
   evidence view asks the server for the control's rules (`GET /api/v1/controls/PROFILE/ID/info`) and shows their fix
   text. When the server knows the control, only its rules speak: a check the rule does not list (one a host slipped in)
   shows no fix at all. Only a control the server has no rules for (a policy pack's: 404) shows the text of the scan,
   labelled as what the scan reported; any other failure to get the rules shows no fix. The CSV of a scan that the
   dashboard offers is made the same way. The stored result itself (`GET /api/v1/scans/ID`) stays as the host sent it:
   it is the host's document, the evidence.
3. If structured fixes come later, they must be: declarative (a target state such as a drop-in file, a key and a value,
   a file mode) that vmsctl turns into text, so that parameters are respected and rules hold no shell; shown only from
   the renderer's own rules, never carried in or read from a result; not allowed in policy packs; labelled with the
   distributions they were tested on; each proven in a fresh container, applied twice, with only PASS counting; shown one
   at a time under the prose, with no bulk copy, no script export and no execution by the agent. That needs a new ADR.

## Consequences

- A host cannot put words in the project's mouth on the dashboard: for built-in checks the fix text is the server's.
- The evidence view makes one more request the first time a control is opened (the control's rules, small; the page keeps
  them while it is open, since they do not change while the server runs).
- `vmsctl report` does the same with the rules built into the binary (#331): a result file may come from any host. A policy
  pack's controls keep the file's text there, since the server-side reason (anyone with a host's token) does not apply to
  the person who holds the files and ran the pack. One function does it for both (`output.TrustFixes`).
- Per-distribution commands are not built. Configuration management (ComplianceAsCode, ansible-lockdown) remains the
  answer for applying a baseline in bulk.
