package output

import (
	"slices"
	"strings"

	"github.com/with-developer/vmsctl/internal/engine"
)

// TrustFixes replaces, in a result that came from elsewhere (a host, a file), the fix text of the checks of built-in controls with
// the text of the rules in content (ADR 0018): a result cannot put its own words in the project's mouth. A check that the rule's
// control does not list gets none. The controls of a profile content does not have (a policy pack's) keep the result's text. A nil
// content changes nothing.
func TrustFixes(res *engine.Result, content *engine.Content) {
	if content == nil || res == nil {
		return
	}
	byRef := map[string]*engine.CheckResult{}
	for i := range res.Checks {
		byRef[res.Checks[i].Ref] = &res.Checks[i]
	}
	for _, c := range res.Controls {
		ctl := builtinControl(content, c.Profile, c.ID)
		if ctl == nil {
			continue
		}
		for _, ref := range c.Checks {
			ck := byRef[ref]
			if ck == nil {
				continue
			}
			rule := content.Checks[ck.ID]
			if rule == nil || !slices.Contains(ctl.Checks, ck.ID) {
				ck.Remediation, ck.RemediationKo = "", ""
				continue
			}
			ck.Remediation, ck.RemediationKo = strings.TrimSpace(rule.Remediation), strings.TrimSpace(rule.RemediationKo)
		}
	}
}

func builtinControl(content *engine.Content, profile, id string) *engine.Control {
	p := content.Profiles[profile]
	if p == nil {
		return nil
	}
	for i := range p.Controls {
		if p.Controls[i].ID == id {
			return &p.Controls[i]
		}
	}
	return nil
}
