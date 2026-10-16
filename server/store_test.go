package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func name(t *testing.T, s string) Name {
	t.Helper()
	n, err := ParseName(s)
	if err != nil {
		t.Fatalf("ParseName(%q): %v", s, err)
	}
	return n
}

func ref(t *testing.T, g, b string) BoardRef {
	t.Helper()
	r, err := ParseRef(g, b)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func open(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}

func TestParseName(t *testing.T) {
	ok := []string{"a", "My board", "über ñ", "a.b", "-x", strings.Repeat("é", 100)}
	bad := []string{"", "../x", "a/b", `a\b`, ".hidden", "..", ".", "trailing ", "trailing.", "con\x00", "tab\there", "x\u007f", strings.Repeat("a", 101), "\xff"}
	for _, s := range ok {
		if n, err := ParseName(s); err != nil || n.String() != s {
			t.Errorf("ParseName(%q) = %q, %v; want accepted", s, n, err)
		}
	}
	for _, s := range bad {
		if _, err := ParseName(s); !errors.Is(err, ErrInvalid) {
			t.Errorf("ParseName(%q) err = %v; want ErrInvalid", s, err)
		}
	}
}

func TestWriteReadRoundTripAndRev(t *testing.T) {
	s, root := open(t)
	if err := s.CreateGroup(name(t, "G")); err != nil {
		t.Fatal(err)
	}
	b := ref(t, "G", "one")
	rev1, err := s.Write(b, []byte(`{"v":1}`), "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(rev1), "-7") {
		t.Errorf("rev %q should end with size 7", rev1)
	}
	got, rev, err := s.Read(b)
	if string(got) != `{"v":1}` || rev != rev1 || err != nil {
		t.Fatalf("Read = %q %q %v", got, rev, err)
	}
	if on, _ := os.ReadFile(filepath.Join(root, "G", "one.excalidraw")); string(on) != `{"v":1}` {
		t.Errorf("on disk %q", on)
	}
	rev2, err := s.Write(b, []byte(`{"v":22}`), rev1)
	if err != nil || rev2 == rev1 || !strings.HasSuffix(string(rev2), "-8") {
		t.Errorf("second write rev = %q (first %q), err %v", rev2, rev1, err)
	}
	if _, err := s.Write(b, []byte(`{"v":22}`), rev2); err != nil {
		t.Errorf("re-write of same body: %v", err)
	}
	if _, _, err := s.Read(ref(t, "G", "nope")); !errors.Is(err, ErrNotFound) {
		t.Errorf("Read missing = %v", err)
	}
}

func TestWriteConflictAndExclusiveCreate(t *testing.T) {
	s, _ := open(t)
	b := ref(t, "", "root")
	rev1, _ := s.Write(b, []byte("a"), "")
	if _, err := s.Write(b, []byte("b"), ""); !errors.Is(err, ErrExists) {
		t.Errorf("second exclusive create = %v; want ErrExists", err)
	}
	rev2, _ := s.Write(b, []byte("bb"), rev1)
	_, err := s.Write(b, []byte("c"), rev1)
	var c ErrConflict
	if !errors.As(err, &c) || c.Current != rev2 {
		t.Errorf("stale write = %v; want ErrConflict{%q}", err, rev2)
	}
	if got, _, _ := s.Read(b); string(got) != "bb" {
		t.Errorf("content after conflict = %q", got)
	}
	if _, err := s.Write(ref(t, "", "ghost"), []byte("x"), "1-1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("update of missing = %v", err)
	}
	if _, err := s.Write(ref(t, "NoGroup", "x"), []byte("x"), ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("write into missing group = %v", err)
	}
	if _, err := s.Write(BoardRef{}, []byte("x"), ""); !errors.Is(err, ErrInvalid) {
		t.Errorf("write with zero name = %v", err)
	}
}

func TestConcurrentWritesOneWins(t *testing.T) {
	s, _ := open(t)
	b := ref(t, "", "race")
	rev, _ := s.Write(b, []byte("0"), "")
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = s.Write(b, []byte(strings.Repeat("x", i+5)), rev)
		}()
	}
	wg.Wait()
	wins := 0
	for _, e := range errs {
		var c ErrConflict
		switch {
		case e == nil:
			wins++
		case !errors.As(e, &c):
			t.Errorf("loser error = %v", e)
		}
	}
	if wins != 1 {
		t.Errorf("winners = %d; want 1", wins)
	}
}

func TestMove(t *testing.T) {
	s, _ := open(t)
	s.CreateGroup(name(t, "A"))
	s.CreateGroup(name(t, "B"))
	s.Write(ref(t, "A", "x"), []byte("X"), "")
	if err := s.Move(ref(t, "A", "x"), ref(t, "B", "y")); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := s.Read(ref(t, "B", "y")); string(got) != "X" {
		t.Errorf("moved content %q", got)
	}
	if _, _, err := s.Read(ref(t, "A", "x")); !errors.Is(err, ErrNotFound) {
		t.Errorf("source still there: %v", err)
	}
	if err := s.Move(ref(t, "B", "y"), ref(t, "", "top")); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := s.Read(ref(t, "", "top")); string(got) != "X" {
		t.Errorf("moved to root content %q", got)
	}
	s.Write(ref(t, "A", "Taken"), []byte("T"), "")
	if err := s.Move(ref(t, "", "top"), ref(t, "A", "taken")); !errors.Is(err, ErrExists) {
		t.Errorf("move onto existing (case-insensitive) = %v", err)
	}
	if err := s.Move(ref(t, "A", "Taken"), ref(t, "A", "TAKEN")); err != nil {
		t.Errorf("case-only rename: %v", err)
	}
	if err := s.Move(ref(t, "", "ghost"), ref(t, "A", "z")); !errors.Is(err, ErrNotFound) {
		t.Errorf("move missing = %v", err)
	}
	if _, err := s.Write(ref(t, "A", "taken"), []byte("again"), ""); !errors.Is(err, ErrExists) {
		t.Errorf("create differing only by case = %v", err)
	}
}

func TestTrash(t *testing.T) {
	s, root := open(t)
	s.CreateGroup(name(t, "G"))
	s.Write(ref(t, "G", "b"), []byte("keep me"), "")
	if err := s.Trash(ref(t, "G", "b")); err != nil {
		t.Fatal(err)
	}
	tr, _ := filepath.Glob(filepath.Join(root, ".trash", "*-G-b.excalidraw"))
	if len(tr) != 1 {
		t.Fatalf("trash files = %v", tr)
	}
	if got, _ := os.ReadFile(tr[0]); string(got) != "keep me" {
		t.Errorf("trashed content %q", got)
	}
	if tree, _ := s.Tree(); len(tree.Groups[0].Boards) != 0 {
		t.Errorf("board still in tree: %+v", tree)
	}
	s.Write(ref(t, "G", "b"), []byte("second"), "")
	if err := s.Trash(ref(t, "G", "b")); err != nil {
		t.Fatal(err)
	}
	if tr, _ = filepath.Glob(filepath.Join(root, ".trash", "*-G-b*.excalidraw")); len(tr) != 2 {
		t.Errorf("collision-safe trash files = %v", tr)
	}
	if err := s.Trash(ref(t, "G", "b")); !errors.Is(err, ErrNotFound) {
		t.Errorf("trash missing = %v", err)
	}
}

func TestTreeOrderingHidingAndUngrouped(t *testing.T) {
	s, root := open(t)
	for _, g := range []string{"beta", "Alpha", "gamma"} {
		s.CreateGroup(name(t, g))
	}
	s.Write(ref(t, "Alpha", "b"), []byte("1"), "")
	s.Write(ref(t, "Alpha", "A"), []byte("1"), "")
	s.Write(ref(t, "Alpha", "c"), []byte("1"), "")
	s.Write(ref(t, "", "zed"), []byte("1"), "")
	s.Write(ref(t, "", "Root"), []byte("1"), "")
	os.WriteFile(filepath.Join(root, "Alpha", ".secret.excalidraw"), nil, 0o644)
	os.WriteFile(filepath.Join(root, "Alpha", "notes.txt"), nil, 0o644)
	os.Mkdir(filepath.Join(root, ".trash"), 0o755)
	tree, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	var groups []string
	for _, g := range tree.Groups {
		groups = append(groups, g.Name.String())
	}
	if want := []string{"Alpha", "beta", "gamma"}; !reflect.DeepEqual(groups, want) {
		t.Errorf("groups = %v; want %v", groups, want)
	}
	var bs []string
	for _, b := range tree.Groups[0].Boards {
		bs = append(bs, b.Name.String())
	}
	if want := []string{"A", "b", "c"}; !reflect.DeepEqual(bs, want) {
		t.Errorf("boards = %v; want %v", bs, want)
	}
	var ug []string
	for _, b := range tree.Ungrouped {
		ug = append(ug, b.Name.String())
	}
	if want := []string{"Root", "zed"}; !reflect.DeepEqual(ug, want) {
		t.Errorf("ungrouped = %v; want %v", ug, want)
	}
	if tree.Groups[0].Boards[0].Rev == "" {
		t.Error("board rev empty")
	}
}

func TestGroups(t *testing.T) {
	s, root := open(t)
	g := name(t, "Proj")
	if err := s.CreateGroup(g); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateGroup(name(t, "proj")); !errors.Is(err, ErrExists) {
		t.Errorf("duplicate group = %v", err)
	}
	s.Write(ref(t, "Proj", "b"), []byte("1"), "")
	s.CreateGroup(name(t, "Other"))
	if err := s.RenameGroup(g, name(t, "other")); !errors.Is(err, ErrExists) {
		t.Errorf("rename onto existing = %v", err)
	}
	if err := s.RenameGroup(g, name(t, "Renamed")); err != nil {
		t.Fatal(err)
	}
	if got, _, err := s.Read(ref(t, "Renamed", "b")); string(got) != "1" || err != nil {
		t.Errorf("board after group rename: %q %v", got, err)
	}
	if err := s.RenameGroup(g, name(t, "x")); !errors.Is(err, ErrNotFound) {
		t.Errorf("rename missing = %v", err)
	}
	if err := s.TrashGroup(name(t, "Renamed")); err != nil {
		t.Fatal(err)
	}
	tr, _ := filepath.Glob(filepath.Join(root, ".trash", "*-Renamed", "b.excalidraw"))
	if len(tr) != 1 {
		t.Errorf("trashed group contents = %v", tr)
	}
	tree, _ := s.Tree()
	if len(tree.Groups) != 1 || tree.Groups[0].Name.String() != "Other" {
		t.Errorf("groups after trash = %+v", tree.Groups)
	}
	if err := s.TrashGroup(name(t, "Renamed")); !errors.Is(err, ErrNotFound) {
		t.Errorf("trash missing group = %v", err)
	}
}

func TestLastState(t *testing.T) {
	s, root := open(t)
	s.CreateGroup(name(t, "G"))
	s.Write(ref(t, "G", "b"), []byte("1"), "")
	s.Write(ref(t, "", "top"), []byte("1"), "")
	if tree, _ := s.Tree(); tree.Last != nil {
		t.Errorf("fresh last = %+v", tree.Last)
	}
	for _, want := range []BoardRef{ref(t, "G", "b"), ref(t, "", "top")} {
		if err := s.SetLast(&want); err != nil {
			t.Fatal(err)
		}
		if tree, _ := s.Tree(); tree.Last == nil || *tree.Last != want {
			t.Errorf("last = %+v; want %+v", tree.Last, want)
		}
	}
	s.SetLast(nil)
	if tree, _ := s.Tree(); tree.Last != nil {
		t.Errorf("cleared last = %+v", tree.Last)
	}
	b := ref(t, "G", "b")
	s.SetLast(&b)
	os.WriteFile(filepath.Join(root, ".state.json"), []byte("{not json"), 0o644)
	if tree, err := s.Tree(); err != nil || tree.Last != nil {
		t.Errorf("corrupt state: last %+v err %v", tree.Last, err)
	}
	s.SetLast(&b)
	s.Trash(b)
	if tree, _ := s.Tree(); tree.Last != nil {
		t.Errorf("last pointing at trashed board = %+v", tree.Last)
	}
}

func TestOpenSweepsTempFiles(t *testing.T) {
	root := t.TempDir()
	os.Mkdir(filepath.Join(root, "G"), 0o755)
	stray := []string{filepath.Join(root, ".tmp-123"), filepath.Join(root, "G", ".tmp-456")}
	keep := filepath.Join(root, "G", "real.excalidraw")
	for _, p := range append(stray, keep) {
		os.WriteFile(p, []byte("x"), 0o644)
	}
	if _, err := Open(root); err != nil {
		t.Fatal(err)
	}
	for _, p := range stray {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s survived sweep (%v)", p, err)
		}
	}
	if _, err := os.Stat(keep); err != nil {
		t.Errorf("real board removed: %v", err)
	}
}

func TestWriteAtomicLeavesNoTempFiles(t *testing.T) {
	s, root := open(t)
	s.Write(ref(t, "", "a"), []byte("1"), "")
	es, _ := os.ReadDir(root)
	if len(es) != 1 || es[0].Name() != "a.excalidraw" {
		t.Errorf("dir entries = %v", es)
	}
}

func TestSortIsCaseInsensitive(t *testing.T) {
	s, _ := open(t)
	for _, n := range []string{"B", "a", "C"} {
		s.Write(ref(t, "", n), []byte("1"), "")
	}
	tree, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, b := range tree.Ungrouped {
		got = append(got, b.Name.String())
	}
	if want := []string{"a", "B", "C"}; !reflect.DeepEqual(got, want) {
		t.Errorf("ungrouped = %v; want %v", got, want)
	}
}

func TestWrittenFilesAreWorldReadable(t *testing.T) {
	s, root := open(t)
	if _, err := s.Write(ref(t, "", "a"), []byte("{}"), ""); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(root, "a.excalidraw"))
	if err != nil {
		t.Fatal(err)
	}
	if got := fi.Mode().Perm(); got != 0o644 {
		t.Errorf("mode = %v; want 0644", got)
	}
}

func TestParseRef(t *testing.T) {
	if r, err := ParseRef("", "a"); err != nil || r.Group.s != "" || r.Name.s != "a" {
		t.Errorf(`ParseRef("", "a") = %+v, %v`, r, err)
	}
	if r, err := ParseRef("G", "a"); err != nil || r.Group.s != "G" || r.Name.s != "a" {
		t.Errorf(`ParseRef("G", "a") = %+v, %v`, r, err)
	}
	for _, c := range [][2]string{{"", ""}, {"..", "a"}, {"G", ".x"}} {
		if _, err := ParseRef(c[0], c[1]); !errors.Is(err, ErrInvalid) {
			t.Errorf("ParseRef(%q, %q) err = %v; want ErrInvalid", c[0], c[1], err)
		}
	}
}

func TestTreeMarshalsNamesAsStrings(t *testing.T) {
	tree := Tree{
		Groups:    []Group{{name(t, "G"), []Board{{name(t, "b"), "1-2"}}}},
		Ungrouped: []Board{{name(t, "u"), "3-4"}},
	}
	data, err := json.Marshal(tree)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Groups []struct {
			Name   string
			Boards []struct{ Name string }
		}
		Ungrouped []struct{ Name string }
		Last      *BoardRef
	}
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("%s: %v", data, err)
	}
	if len(got.Groups) != 1 || got.Groups[0].Name != "G" || got.Groups[0].Boards[0].Name != "b" || got.Ungrouped[0].Name != "u" || got.Last != nil {
		t.Errorf("json = %s", data)
	}
	if empty, _ := json.Marshal(BoardRef{Name: name(t, "a")}); string(empty) != `{"Group":"","Name":"a"}` {
		t.Errorf("ungrouped ref = %s", empty)
	}
}

func TestRenameGroupCaseOnly(t *testing.T) {
	s, _ := open(t)
	if err := s.CreateGroup(name(t, "alpha")); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameGroup(name(t, "alpha"), name(t, "Alpha")); err != nil {
		t.Fatalf("case-only rename: %v", err)
	}
	tree, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Groups) != 1 || tree.Groups[0].Name.String() != "Alpha" {
		t.Errorf("groups = %v; want [Alpha]", tree.Groups)
	}
	if err := s.CreateGroup(name(t, "beta")); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameGroup(name(t, "beta"), name(t, "ALPHA")); !errors.Is(err, ErrExists) {
		t.Errorf("rename onto other group = %v; want ErrExists", err)
	}
}
