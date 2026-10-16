package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const ext = ".excalidraw"

var (
	ErrNotFound = errors.New("not found")
	ErrExists   = errors.New("already exists")
	ErrInvalid  = errors.New("invalid name")
)

// ErrConflict reports a stale If-Match; Current is the rev on disk.
type ErrConflict struct{ Current Rev }

func (e ErrConflict) Error() string { return "revision conflict, current " + string(e.Current) }

// Name is a validated file-safe name. The zero Name is not valid and
// only appears as the empty group of a BoardRef.
type Name struct{ s string }

func (n Name) String() string { return n.s }

func (n Name) MarshalText() ([]byte, error) { return []byte(n.s), nil }

func ParseName(s string) (Name, error) {
	bad := func(why string) (Name, error) { return Name{}, fmt.Errorf("%w: %s", ErrInvalid, why) }
	switch {
	case !utf8.ValidString(s):
		return bad("not utf-8")
	case utf8.RuneCountInString(s) < 1 || utf8.RuneCountInString(s) > 100:
		return bad("length must be 1 to 100 characters")
	case len(s) > 200: // leaves room for ".excalidraw" under the 255-byte filename limit
		return bad("too long")
	case strings.HasPrefix(s, "."):
		return bad("leading dot")
	case strings.HasSuffix(s, " ") || strings.HasSuffix(s, "."):
		return bad("trailing space or dot")
	case strings.ContainsFunc(s, func(r rune) bool { return r == '/' || r == '\\' || unicode.IsControl(r) }):
		return bad("forbidden character")
	}
	return Name{s}, nil
}

// ParseRef is the one place an empty group becomes Ungrouped.
func ParseRef(group, name string) (BoardRef, error) {
	n, err := ParseName(name)
	if err != nil {
		return BoardRef{}, err
	}
	r := BoardRef{Name: n}
	if group != "" {
		if r.Group, err = ParseName(group); err != nil {
			return BoardRef{}, err
		}
	}
	return r, nil
}

// Rev is "<mtimeNanos>-<size>", derived from the file and never stored.
type Rev string

// BoardRef addresses a board; an empty Group means Ungrouped (data dir root).
type BoardRef struct{ Group, Name Name }

type Board struct {
	Name Name
	Rev  Rev
}
type Group struct {
	Name   Name
	Boards []Board
}
type Tree struct {
	Groups    []Group
	Ungrouped []Board
	Last      *BoardRef
}

type Store struct {
	root string
	mu   sync.Mutex
}

func Open(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	s := &Store{root: root}
	dirs := []string{root}
	es, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	for _, e := range es {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, filepath.Join(root, e.Name()))
		}
	}
	for _, d := range dirs {
		tmps, _ := filepath.Glob(filepath.Join(d, ".tmp-*"))
		for _, t := range tmps {
			os.Remove(t)
		}
	}
	return s, nil
}

// lookup returns the on-disk spelling of name in dir (case-insensitive) when
// present, else dir/name.
func lookup(dir, name string, isDir bool) (path string, exists bool, err error) {
	es, err := os.ReadDir(dir)
	if err != nil {
		return "", false, err
	}
	for _, e := range es {
		if e.IsDir() == isDir && strings.EqualFold(e.Name(), name) {
			return filepath.Join(dir, e.Name()), true, nil
		}
	}
	return filepath.Join(dir, name), false, nil
}

// group resolves g; the empty group is the root.
func (s *Store) group(g Name) (string, error) {
	if g.s == "" {
		return s.root, nil
	}
	p, ok, err := lookup(s.root, g.s, true)
	if err == nil && !ok {
		err = ErrNotFound
	}
	return p, err
}

// board resolves b; exists is false when no case-insensitive match is on disk.
func (s *Store) board(b BoardRef) (path string, exists bool, err error) {
	if b.Name.s == "" {
		return "", false, ErrInvalid
	}
	dir, err := s.group(b.Group)
	if err != nil {
		return "", false, err
	}
	return lookup(dir, b.Name.s+ext, false)
}

func (s *Store) existing(b BoardRef) (string, error) {
	p, ok, err := s.board(b)
	if err == nil && !ok {
		err = ErrNotFound
	}
	return p, err
}

func sortByName[T any](xs []T, name func(T) Name) {
	slices.SortFunc(xs, func(a, b T) int {
		return strings.Compare(strings.ToLower(name(a).s), strings.ToLower(name(b).s))
	})
}

func revOf(fi os.FileInfo) Rev { return Rev(fmt.Sprintf("%d-%d", fi.ModTime().UnixNano(), fi.Size())) }

func (s *Store) boards(dir string) ([]Board, error) {
	es, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []Board{}
	for _, e := range es {
		base, ok := strings.CutSuffix(e.Name(), ext)
		n, perr := ParseName(base)
		if e.IsDir() || !ok || perr != nil {
			continue
		}
		if fi, err := e.Info(); err == nil {
			out = append(out, Board{n, revOf(fi)})
		}
	}
	sortByName(out, func(b Board) Name { return b.Name })
	return out, nil
}

func (s *Store) Tree() (Tree, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := Tree{Groups: []Group{}}
	es, err := os.ReadDir(s.root)
	if err != nil {
		return t, err
	}
	for _, e := range es {
		n, perr := ParseName(e.Name())
		if !e.IsDir() || perr != nil {
			continue
		}
		bs, err := s.boards(filepath.Join(s.root, e.Name()))
		if err != nil {
			return t, err
		}
		t.Groups = append(t.Groups, Group{n, bs})
	}
	sortByName(t.Groups, func(g Group) Name { return g.Name })
	if t.Ungrouped, err = s.boards(s.root); err != nil {
		return t, err
	}
	if l := s.last(); l != nil {
		if _, ok, err := s.board(*l); err == nil && ok {
			t.Last = l
		}
	}
	return t, nil
}

func (s *Store) Read(b BoardRef) ([]byte, Rev, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.existing(b)
	if err != nil {
		return nil, "", err
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, "", err
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, "", err
	}
	return data, revOf(fi), nil
}

// Write creates the board when ifMatch is "" (failing with ErrExists if present)
// and otherwise replaces it only if its current Rev equals ifMatch.
func (s *Store) Write(b BoardRef, body []byte, ifMatch Rev) (Rev, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok, err := s.board(b)
	if err != nil {
		return "", err
	}
	switch {
	case ifMatch == "" && ok:
		return "", ErrExists
	case ifMatch != "" && !ok:
		return "", ErrNotFound
	case ok:
		fi, err := os.Stat(p)
		if err != nil {
			return "", err
		}
		if cur := revOf(fi); cur != ifMatch {
			return "", ErrConflict{cur}
		}
	}
	if err := writeAtomic(p, body); err != nil {
		return "", err
	}
	fi, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	return revOf(fi), nil
}

// Move renames and/or regroups a board; a case-only rename of itself is allowed.
func (s *Store) Move(from, to BoardRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.existing(from)
	if err != nil {
		return err
	}
	dst, taken, err := s.board(to)
	if err != nil {
		return err
	}
	if taken && dst != src {
		return ErrExists
	}
	return os.Rename(src, filepath.Join(filepath.Dir(dst), to.Name.s+ext))
}

func (s *Store) Trash(b BoardRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.existing(b)
	if err != nil {
		return err
	}
	label := b.Name.s
	if b.Group.s != "" {
		label = b.Group.s + "-" + label
	}
	return s.toTrash(p, label, ext)
}

func (s *Store) toTrash(path, label, suffix string) error {
	dir := filepath.Join(s.root, ".trash")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	base := filepath.Join(dir, time.Now().UTC().Format("20060102T150405Z")+"-"+label)
	dst := base + suffix
	for i := 1; ; i++ {
		if _, err := os.Lstat(dst); errors.Is(err, os.ErrNotExist) {
			break
		}
		dst = fmt.Sprintf("%s-%d%s", base, i, suffix)
	}
	return os.Rename(path, dst)
}

func (s *Store) CreateGroup(g Name) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if g.s == "" {
		return ErrInvalid
	}
	p, exists, err := lookup(s.root, g.s, true)
	if err != nil {
		return err
	}
	if exists {
		return ErrExists
	}
	return os.Mkdir(p, 0o755)
}

func (s *Store) RenameGroup(from, to Name) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if from.s == "" || to.s == "" {
		return ErrInvalid
	}
	src, err := s.group(from)
	if err != nil {
		return err
	}
	dst, exists, err := lookup(s.root, to.s, true)
	if err != nil {
		return err
	}
	if exists && dst != src {
		return ErrExists
	}
	return os.Rename(src, filepath.Join(s.root, to.s))
}

func (s *Store) TrashGroup(g Name) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if g.s == "" {
		return ErrInvalid
	}
	p, err := s.group(g)
	if err != nil {
		return err
	}
	return s.toTrash(p, g.s, "")
}

type stateFile struct {
	Last *struct{ Group, Name string } `json:"last"`
}

// last returns nil for a missing, corrupt or invalid state file.
func (s *Store) last() *BoardRef {
	data, err := os.ReadFile(filepath.Join(s.root, ".state.json"))
	var st stateFile
	if err != nil || json.Unmarshal(data, &st) != nil || st.Last == nil {
		return nil
	}
	ref, err := ParseRef(st.Last.Group, st.Last.Name)
	if err != nil {
		return nil
	}
	return &ref
}

func (s *Store) SetLast(b *BoardRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var st stateFile
	if b != nil {
		st.Last = &struct{ Group, Name string }{b.Group.s, b.Name.s}
	}
	data, _ := json.Marshal(st)
	return writeAtomic(filepath.Join(s.root, ".state.json"), data)
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	err = f.Chmod(0o644)
	if err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(f.Name(), path)
	}
	if err != nil {
		os.Remove(f.Name())
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
