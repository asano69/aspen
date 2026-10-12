package search

import "testing"

func TestBleveIndexSearchDelete(t *testing.T) {
	e, err := OpenBleve(t.TempDir() + "/idx")
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()

	docs := []Doc{
		{ID: "a", PotID: "p1", Title: "Hello World", Body: "foo bar"},
		{ID: "b", PotID: "p1", Title: "日本語のメモ", Body: "全文検索のテスト"},
		{ID: "c", PotID: "p2", Title: "Hello", Body: "other pot"},
	}
	for _, d := range docs {
		if err := e.Index(d); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		text, pot string
		want      []string
	}{
		{"hello", "p1", []string{"a"}}, // case-insensitive, pot-scoped
		{"全文検索", "p1", []string{"b"}},  // Japanese body
		{"hello", "p2", []string{"c"}},
		{"missing", "p1", nil},
	}
	for _, c := range cases {
		res, err := e.Search(Query{Text: c.text, PotID: c.pot, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		if len(res.IDs) != len(c.want) || (len(c.want) > 0 && res.IDs[0] != c.want[0]) {
			t.Errorf("%q in %s: got %v, want %v", c.text, c.pot, res.IDs, c.want)
		}
	}

	if err := e.Delete("a"); err != nil {
		t.Fatal(err)
	}
	res, _ := e.Search(Query{Text: "hello", PotID: "p1", Limit: 10})
	if len(res.IDs) != 0 {
		t.Errorf("deleted doc still found: %v", res.IDs)
	}
}
