package library

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// #1420's search lists archify from several repositories. Only the source
// actually installed is had; the others, and local skills with no provable
// market identity (#444), occupy a name without claiming every listing.
func TestMarketSkillIdentity(t *testing.T) {
	sandbox(t)
	entries := []skillsShEntry{
		{Source: "tt-a1i/archify", SkillID: "archify", Name: "archify"},
		{Source: "xgent-ai/skills", SkillID: "archify", Name: "archify"},
		{Source: "tyf1996/archify", SkillID: "archify", Name: "archify"},
		{Source: "tt-a1i/archify", SkillID: "archify-review", Name: "archify"},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/search" || r.URL.Query().Get("q") != "archify" {
			t.Errorf("unexpected market request: %s", r.URL)
		}
		json.NewEncoder(w).Encode(map[string]any{"skills": entries})
	}))
	defer server.Close()
	wasURL := skillsShURL
	skillsShURL = server.URL
	t.Cleanup(func() { skillsShURL = wasURL })
	popular.Lock()
	wasList, wasAt := popular.list, popular.at
	popular.list, popular.at = entries, time.Now()
	popular.Unlock()
	t.Cleanup(func() {
		popular.Lock()
		popular.list, popular.at = wasList, wasAt
		popular.Unlock()
	})

	for _, c := range []struct {
		name  string
		skill *Skill
		have  string
		other string
	}{
		{"installed", &Skill{Name: "archify", Source: &Source{Kind: "github", Repo: "tt-a1i/archify", Path: "skills/archify"}}, "archify", "archify"},
		{"repository case", &Skill{Name: "archify", Source: &Source{Kind: "github", Repo: "TT-A1I/Archify", Path: "skills/archify"}}, "archify", "archify"},
		{"root skill", &Skill{Name: "archify", Source: &Source{Kind: "github", Repo: "tt-a1i/archify"}}, "archify", "archify"},
		{"renamed", &Skill{Name: "my-archify", Source: &Source{Kind: "github", Repo: "tt-a1i/archify", Path: "skills/archify"}}, "my-archify", ""},
		{"local folder", &Skill{Name: "archify", Source: &Source{Kind: "folder", Dir: "/test/skills/archify"}}, "", "archify"},
		{"unknown source", &Skill{Name: "archify"}, "", "archify"},
		{"empty library", nil, "", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			l := &Library{}
			if c.skill != nil {
				l.Skills = []*Skill{c.skill}
			}
			if err := l.save(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path())
			if err != nil {
				t.Fatal(err)
			}
			for _, q := range []string{"", "archify"} {
				list, err := MarketSkills(q)
				if err != nil {
					t.Fatal(err)
				}
				seen := 0
				for _, m := range list {
					if m.Featured {
						continue
					}
					seen++
					wantHave, wantConflict := "", c.other
					if m.ID == "tt-a1i/archify/archify" && c.have != "" {
						wantHave, wantConflict = c.have, ""
					}
					// Assert the public JSON contract; this also compiles against
					// the pre-fix struct, which has no conflict field.
					b, _ := json.Marshal(m)
					var fields map[string]any
					json.Unmarshal(b, &fields)
					conflict, _ := fields["conflict"].(string)
					if m.Have != wantHave || conflict != wantConflict {
						t.Errorf("q=%q %s: added=%q conflict=%q, want added=%q conflict=%q", q, m.ID, m.Have, conflict, wantHave, wantConflict)
					}
				}
				if seen != len(entries) {
					t.Errorf("q=%q: got %d listings, want %d", q, seen, len(entries))
				}
			}
			after, _ := os.ReadFile(path())
			if !bytes.Equal(before, after) {
				t.Fatal("discovering skills changed the library")
			}
		})
	}

	// The official card uses the same identity rules as search results.
	l := &Library{Skills: []*Skill{{Name: "magpie-quota", Source: &Source{Kind: "github", Repo: "someone/skills", Path: "magpie-quota"}}}}
	if err := l.save(); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(skillsDir(), "magpie-quota", "SKILL.md")
	write(t, file, "# The user's own skill\n")
	list, err := MarketSkills("")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(list[0])
	var fields map[string]any
	json.Unmarshal(b, &fields)
	if !list[0].Featured || list[0].Have != "" || fields["conflict"] != "magpie-quota" {
		t.Errorf("official listing claims another skill: %s", b)
	}
	if b, _ := os.ReadFile(file); string(b) != "# The user's own skill\n" {
		t.Fatal("discovering skills changed the user's files")
	}
}
