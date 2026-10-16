package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"html"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// maxBody is a var so tests can shrink it instead of allocating 64 MiB.
var maxBody int64 = 64 << 20

const bootMarker = "<!--MX_BOOT-->"

// Wire types. Store types never reach the wire.
type wireBoard struct {
	Name string `json:"name"`
	Rev  string `json:"rev"`
}

type wireGroup struct {
	Name   string      `json:"name"`
	Boards []wireBoard `json:"boards"`
}

type wireRef struct {
	Group string `json:"group"`
	Name  string `json:"name"`
}

type wireName struct {
	Name string `json:"name"`
}

type wireTree struct {
	Groups    []wireGroup `json:"groups"`
	Ungrouped []wireBoard `json:"ungrouped"`
	Last      *wireRef    `json:"last"`
}

func toWireBoards(bs []Board) []wireBoard {
	out := make([]wireBoard, 0, len(bs))
	for _, b := range bs {
		out = append(out, wireBoard{b.Name.String(), string(b.Rev)})
	}
	return out
}

func toWireTree(t Tree) wireTree {
	w := wireTree{Groups: make([]wireGroup, 0, len(t.Groups)), Ungrouped: toWireBoards(t.Ungrouped)}
	for _, g := range t.Groups {
		w.Groups = append(w.Groups, wireGroup{g.Name.String(), toWireBoards(g.Boards)})
	}
	if t.Last != nil {
		w.Last = &wireRef{t.Last.Group.String(), t.Last.Name.String()}
	}
	return w
}

type server struct {
	store *Store
	web   fs.FS
}

func newHandler(store *Store, web fs.FS) http.Handler {
	s := &server{store, web}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.index)
	mux.HandleFunc("GET /", s.file)
	mux.HandleFunc("GET /api/tree", s.getTree)
	mux.HandleFunc("GET /api/board", s.getBoard)
	mux.HandleFunc("PUT /api/board", s.putBoard)
	mux.HandleFunc("PATCH /api/board", s.patchBoard)
	mux.HandleFunc("DELETE /api/board", s.deleteBoard)
	mux.HandleFunc("PUT /api/group", s.putGroup)
	mux.HandleFunc("PATCH /api/group", s.patchGroup)
	mux.HandleFunc("DELETE /api/group", s.deleteGroup)
	mux.HandleFunc("PUT /api/last", s.putLast)
	return guard(mux)
}

func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		if !localHost(r.Host) {
			http.Error(w, "bad host", http.StatusMisdirectedRequest)
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodHead:
		case http.MethodOptions:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		default:
			if r.Header.Get("X-MX") != "1" {
				http.Error(w, "missing X-MX", http.StatusForbidden)
				return
			}
			if o := r.Header.Get("Origin"); o != "" && o != "http://"+r.Host {
				http.Error(w, "bad origin", http.StatusForbidden)
				return
			}
			if r.Method == http.MethodPut || r.Method == http.MethodPatch {
				mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if err != nil || mt != "application/json" {
					http.Error(w, "content type must be application/json", http.StatusUnsupportedMediaType)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func localHost(hostport string) bool {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil { // no port, possibly a bare bracketed IPv6 literal
		host, port = strings.Trim(hostport, "[]"), ""
	}
	if _, err := strconv.ParseUint(port, 10, 16); port != "" && err != nil {
		return false
	}
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func fail(w http.ResponseWriter, err error) {
	var c ErrConflict
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &c):
		w.Header().Set("ETag", etag(c.Current))
		http.Error(w, "revision conflict", http.StatusPreconditionFailed)
	case errors.As(err, &tooBig):
		http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
	case errors.Is(err, ErrInvalid):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, ErrExists):
		http.Error(w, "already exists", http.StatusConflict)
	default:
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

func bad(w http.ResponseWriter, msg string) { http.Error(w, msg, http.StatusBadRequest) }

func etag(r Rev) string { return `"` + string(r) + `"` }

func boardRef(r *http.Request) (BoardRef, error) {
	q := r.URL.Query()
	return ParseRef(q.Get("group"), q.Get("name"))
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(http.MaxBytesReader(w, r.Body, maxBody)); err != nil {
		fail(w, err)
		return nil, false
	}
	return buf.Bytes(), true
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	body, ok := readBody(w, r)
	if !ok {
		return false
	}
	if err := json.Unmarshal(body, v); err != nil {
		bad(w, "bad json")
		return false
	}
	return true
}

func done(w http.ResponseWriter, err error) {
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) getTree(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.Tree()
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toWireTree(t))
}

func (s *server) getBoard(w http.ResponseWriter, r *http.Request) {
	b, err := boardRef(r)
	if err != nil {
		fail(w, err)
		return
	}
	data, rev, err := s.store.Read(b)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag(rev))
	w.Write(data)
}

func (s *server) putBoard(w http.ResponseWriter, r *http.Request) {
	b, err := boardRef(r)
	if err != nil {
		fail(w, err)
		return
	}
	ifMatch, ifNone := r.Header.Get("If-Match"), r.Header.Get("If-None-Match")
	var expect Rev
	switch {
	case ifMatch != "" && ifNone != "":
		bad(w, "send either If-Match or If-None-Match")
		return
	case ifMatch != "":
		expect = Rev(strings.Trim(ifMatch, `"`))
		if expect == "" {
			bad(w, "empty If-Match")
			return
		}
	case ifNone == "*":
	case ifNone != "":
		bad(w, "If-None-Match must be *")
		return
	default:
		http.Error(w, "If-Match or If-None-Match required", http.StatusPreconditionRequired)
		return
	}
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	var scene struct {
		Type string `json:"type"`
	}
	if !json.Valid(body) || json.Unmarshal(body, &scene) != nil || scene.Type != "excalidraw" {
		bad(w, "not an excalidraw scene")
		return
	}
	rev, err := s.store.Write(b, body, expect)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("ETag", etag(rev))
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) patchBoard(w http.ResponseWriter, r *http.Request) {
	from, err := boardRef(r)
	if err != nil {
		fail(w, err)
		return
	}
	var dst wireRef
	if !readJSON(w, r, &dst) {
		return
	}
	to, err := ParseRef(dst.Group, dst.Name)
	if err != nil {
		fail(w, err)
		return
	}
	done(w, s.store.Move(from, to))
}

func (s *server) deleteBoard(w http.ResponseWriter, r *http.Request) {
	b, err := boardRef(r)
	if err != nil {
		fail(w, err)
		return
	}
	done(w, s.store.Trash(b))
}

func (s *server) putGroup(w http.ResponseWriter, r *http.Request) {
	g, err := ParseName(r.URL.Query().Get("name"))
	if err != nil {
		fail(w, err)
		return
	}
	done(w, s.store.CreateGroup(g))
}

func (s *server) patchGroup(w http.ResponseWriter, r *http.Request) {
	from, err := ParseName(r.URL.Query().Get("name"))
	if err != nil {
		fail(w, err)
		return
	}
	var dst wireName
	if !readJSON(w, r, &dst) {
		return
	}
	to, err := ParseName(dst.Name)
	if err != nil {
		fail(w, err)
		return
	}
	done(w, s.store.RenameGroup(from, to))
}

func (s *server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	g, err := ParseName(r.URL.Query().Get("name"))
	if err != nil {
		fail(w, err)
		return
	}
	done(w, s.store.TrashGroup(g))
}

func (s *server) putLast(w http.ResponseWriter, r *http.Request) {
	var in *wireRef
	if !readJSON(w, r, &in) {
		return
	}
	if in == nil {
		done(w, s.store.SetLast(nil))
		return
	}
	b, err := ParseRef(in.Group, in.Name)
	if err != nil {
		fail(w, err)
		return
	}
	done(w, s.store.SetLast(&b))
}

func (s *server) index(w http.ResponseWriter, r *http.Request) {
	page, err := fs.ReadFile(s.web, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	t, err := s.store.Tree()
	if err != nil {
		fail(w, err)
		return
	}
	// json.Marshal escapes < > & so no board name can close the script tag.
	tree, _ := json.Marshal(toWireTree(t))
	boot := "<script>window.__BOOT__=" + string(tree) + "</script>"
	if t.Last != nil {
		q := url.Values{"group": {t.Last.Group.String()}, "name": {t.Last.Name.String()}}
		boot += `<link rel="preload" as="fetch" crossorigin="anonymous" href="` +
			html.EscapeString("/api/board?"+q.Encode()) + `">`
	}
	page = bytes.Replace(page, []byte(bootMarker), []byte(boot), 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(page)
}

func (s *server) file(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	data, err := fs.ReadFile(s.web, name)
	if err != nil || name == "index.html" {
		http.NotFound(w, r)
		return
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
