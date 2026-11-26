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
		fstest.MapFS{"x/a.yaml": {Data: []byte(check("x.a", "the rule's fix"))}, "x/b.yaml": {Data: []byte(check("x.b", "b's fix"))}},
		fstest.MapFS{"p.yaml": {Data: []byte("id: p\nrevision: 1\ntitle: P\ncontrols:\n  - {id: C, title: C, severity: low, checks: [x.a]}\n")}},
	)
	if err != nil {
		t.Fatal(err)
	}
	res := &engine.Result{
		Controls: []engine.ControlResult{
			{Profile: "p", ID: "C", Checks: []string{"x.a", "x.b", "x-evil.c"}},
			{Profile: "x-pack", ID: "P-1", Checks: []string{"x-pack.d"}},
		},
		Checks: []engine.CheckResult{
			{Ref: "x.a", ID: "x.a", Remediation: "PLANTED", RemediationKo: "PLANTED"},
			{Ref: "x.b", ID: "x.b", Remediation: "PLANTED"},           // a built-in check the control does not list
			{Ref: "x-evil.c", ID: "x-evil.c", Remediation: "PLANTED"}, // a check the server has no rule for
			{Ref: "x-pack.d", ID: "x-pack.d", Remediation: "the pack's fix"},
		},
	}
	TrustFixes(res, content)
	want := map[string][2]string{"x.a": {"the rule's fix", "한국어 the rule's fix"}, "x.b": {"", ""}, "x-evil.c": {"", ""}, "x-pack.d": {"the pack's fix", ""}}
	for _, c := range res.Checks {
		if got := [2]string{c.Remediation, c.RemediationKo}; got != want[c.ID] {
			t.Errorf("%s: %q, want %q", c.ID, got, want[c.ID])
		}
	}
	TrustFixes(res, nil) // no rules: nothing changes, nothing panics
}
