package output

import (
	"testing"
	"testing/fstest"

	"github.com/with-developer/vmsctl/internal/engine"
)

func TestTrustFixes(t *testing.T) {
	check := func(id, fix string) string {
		return "id: " + id + "\nversion: 1\ntitle: T\nseverity: low\nremediation: " + fix + "\nremediation_ko: 한국어 " + fix + "\nexpect: >-\n  svc.present\n" +
			"tests:\n  - {name: p, facts: {svc: {present: true}}, want: PASS}\n  - {name: f, facts: {svc: {present: false}}, want: FAIL}\n  - {name: a, input: absent, want: ERROR}\n"
	}
	content, err := engine.Load(
		fstest.MapFS{"x/a.yaml": {Data: []byte(check("x.a", "a's fix"))}, "x/b.yaml": {Data: []byte(check("x.b", "b's fix"))}},
		fstest.MapFS{"p.yaml": {Data: []byte("id: p\nrevision: 1\ntitle: P\ncontrols:\n  - {id: C, title: C, severity: low, checks: [x.a]}\n")}},
	)
	if err != nil {
		t.Fatal(err)
	}
	const planted = "PLANTED"
	res := &engine.Result{
		Controls: []engine.ControlResult{
			{Profile: "p", ID: "C", Checks: []string{"x.a", "x-evil.c"}},
			{Profile: "p", ID: "U-99", Checks: []string{"x-evil.e"}}, // a control the built-in profile does not have
			{Profile: "x-pack", ID: "P-1", Checks: []string{"x-pack.d", "x.b"}},
		},
		Checks: []engine.CheckResult{
			{Ref: "x.a", ID: "x.a", Status: engine.StatusFail, Remediation: planted, RemediationKo: planted},
			{Ref: "x.b", ID: "x.b", Status: engine.StatusFail, Remediation: planted},                    // built-in, under a pack control
			{Ref: "x-evil.c", ID: "x-evil.c", Status: engine.StatusFail, Remediation: planted},          // slipped under a built-in control
			{Ref: "x-evil.e", ID: "x-evil.e", Status: engine.StatusFail, Remediation: planted},          // under a made-up control of a built-in profile
			{Ref: "x-pack.d", ID: "x-pack.d", Status: engine.StatusFail, Remediation: "the pack's fix"}, // a pack's own check
			{Ref: "x-loose.f", ID: "x-loose.f", Status: engine.StatusFail, Remediation: planted},        // under no control
			{Ref: "x.b#1", ID: "x.b", Status: engine.StatusError, Remediation: planted},                 // built-in, not failed
			{Ref: "x.a#2", ID: "x.a", Status: engine.StatusWaived, OriginalStatus: engine.StatusFail},   // waived: still says how
			{Ref: "noprefix.g", ID: "noprefix.g", Status: engine.StatusFail, Remediation: planted},      // unknown, not a pack's ID
		},
	}
	res.Controls[2].Checks = append(res.Controls[2].Checks, "noprefix.g")
	TrustFixes(res, content)
	want := map[string][2]string{
		"x.a": {"a's fix", "한국어 a's fix"}, "x.b": {"b's fix", "한국어 b's fix"}, "x-evil.c": {"", ""}, "x-evil.e": {"", ""},
		"x-pack.d": {"the pack's fix", ""}, "x-loose.f": {"", ""}, "x.b#1": {"", ""}, "x.a#2": {"a's fix", "한국어 a's fix"}, "noprefix.g": {"", ""},
	}
	for _, c := range res.Checks {
		if got := [2]string{c.Remediation, c.RemediationKo}; got != want[c.Ref] {
			t.Errorf("%s: %q, want %q", c.Ref, got, want[c.Ref])
		}
	}
	TrustFixes(res, nil) // no rules: nothing changes, nothing panics
}
