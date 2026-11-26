# 0019. Fix text is trusted per check, in every place that shows a result from elsewhere

- Status: Accepted (amends [0018](0018-fix-text-comes-from-the-rules.md))
- Date: 2026-11-26

## Context

ADR 0018 made the dashboard take the fix of a built-in check from the server's rules, by control: under a control the server knows,
each listed check got the rule's text and anything else none; a control the server did not know kept the scan's text. It left
`vmsctl report` as a follow-up.

Extending it to the report (#331), a review found that "by control" leaves ways around it, on the server's CSV as well as in the
report:

- A built-in check that the result lists under no control keeps its own text. The report keeps one entry per check across
  hosts, and the first host's text wins: one file's planted fix appeared under another host's control (reproduced).
- A control the built-in profile does not have (`kisa-2026` `U-99`) was taken for a pack's and kept the result's text.
- A built-in check under a pack's control kept the result's text, although the rules have its own.
- The rule's text was put on checks that had not failed (ERROR, PASS), where a scan writes none.

## Decision

The fix text of a result from elsewhere (a host's push, a result file) is decided **per check**, by one function
(`output.TrustFixes`) that the server's scan CSV and `vmsctl report` both use:

- a check the rules know gets the rule's fix, and only if it failed (or was waived after failing), wherever it is listed;
- a check the rules do not know keeps the result's text only if it is a policy pack's own (`x-`) and only controls of
  profiles the rules do not have list it;
- anything else gets none.

The dashboard's evidence view follows the same rule: under a control the server knows, only its rules speak; under a pack's
control, only a pack's own check shows the scan's text, labelled as such; a built-in check there shows none in that view.

## Consequences

- No result can put fix text in the server's CSV, the report or the dashboard for a built-in check, by any placement.
- A built-in check that a pack's control maps shows no fix in the dashboard's evidence view of that control (the CSV and the
  report show the rule's). A lookup of a check's rules by ID would give it there too, if a pack user asks.
- The text shown is the current rule's, whatever version of the check produced the result; an old result shows today's
  guidance.
