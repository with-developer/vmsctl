package output

import (
	"strings"

	"github.com/with-developer/vmsctl/internal/engine"
)

// TrustFixes replaces, in a result that came from elsewhere (a host, a file), the fix text of every check with what the rules in
// content say (ADR 0018, ADR 0019), so that a result cannot put its own words in the project's mouth. It goes by check, not by
// control, since a report shares one entry per check across hosts:
//
//   - a check content has a rule for gets the rule's fix, and only when it failed (as a scan writes it: there is nothing to fix in a
//     check that passed or could not be decided);
//   - a check content does not know keeps the result's text only when it is a policy pack's own (its ID starts with x-) and only
//     controls of profiles content does not have list it: a pack's guidance for a pack's check;
//   - anything else (a check under no control, or slipped under a built-in profile) gets none.
//
// A nil content changes nothing.
func TrustFixes(res *engine.Result, content *engine.Content) {
	if content == nil || res == nil {
		return
	}
	underBuiltin, underPack := map[string]bool{}, map[string]bool{}
	for _, c := range res.Controls {
		for _, ref := range c.Checks {
			if content.Profiles[c.Profile] != nil {
				underBuiltin[ref] = true
			} else {
				underPack[ref] = true
			}
		}
	}
	for i := range res.Checks {
		ck := &res.Checks[i]
		if rule := content.Checks[ck.ID]; rule != nil {
			ck.Remediation, ck.RemediationKo = "", ""
			if ck.Status == engine.StatusFail || ck.OriginalStatus == engine.StatusFail {
				ck.Remediation, ck.RemediationKo = strings.TrimSpace(rule.Remediation), strings.TrimSpace(rule.RemediationKo)
			}
			continue
		}
		if strings.HasPrefix(ck.ID, engine.PackPrefix) && underPack[ck.Ref] && !underBuiltin[ck.Ref] {
			continue
		}
		ck.Remediation, ck.RemediationKo = "", ""
	}
}
