package main

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"
)

const scene = `{"type":"excalidraw","version":2,"elements":[]}`

var webFS = fstest.MapFS{
	"index.html":    {Data: []byte("<html><head><!--MX_BOOT--></head><body>app</body></html>")},
	"assets/app.js": {Data: []byte("console.log(1)")},
	"excalidraw/fonts/Virgil/Virgil-abc.woff2": {Data: []byte("wOF2")},
	"favicon.svg": {Data: []byte("<svg/>")},
}

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return newHandler(st, webFS)
}

// do sends a request as a well-behaved same-origin client; mut can break it.
func do(h http.Handler, method, target, body string, mut ...func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Host = "localhost:8080"
	if method != http.MethodGet {
		r.Header.Set("X-MX", "1")
		r.Header.Set("Content-Type", "application/json")
	}
	for _, m := range mut {
		m(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func hdr(k, v string) func(*http.Request) { return func(r *http.Request) { r.Header.Set(k, v) } }

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, code int) {
	t.Helper()
	if w.Code != code {
		t.Fatalf("status = %d, want %d, body %q", w.Code, code, w.Body.String())
	}
}

func create(t *testing.T, h http.Handler, query, body string) {
	t.Helper()
	wantStatus(t, do(h, "PUT", "/api/board?"+query, body, hdr("If-None-Match", "*")), 204)
}

func TestGuard(t *testing.T) {
	h := newTestHandler(t)
	t.Run("foreign host", func(t *testing.T) {
		wantStatus(t, do(h, "GET", "/api/tree", "", func(r *http.Request) { r.Host = "evil.example:8080" }), 421)
	})
	t.Run("hosts that only start with a loopback name", func(t *testing.T) {
		for _, host := range []string{"localhost.evil.com", "127.0.0.1.evil.com:8080", "localhost:8080@evil.com", "xlocalhost", "::2"} {
			wantStatus(t, do(h, "GET", "/api/tree", "", func(r *http.Request) { r.Host = host }), 421)
		}
	})
	t.Run("loopback hosts", func(t *testing.T) {
		for _, host := range []string{"localhost", "localhost:8080", "127.0.0.1:8080", "[::1]"} {
			wantStatus(t, do(h, "GET", "/api/tree", "", func(r *http.Request) { r.Host = host }), 200)
		}
	})
	t.Run("ipv6 loopback host", func(t *testing.T) {
		wantStatus(t, do(h, "GET", "/api/tree", "", func(r *http.Request) { r.Host = "[::1]:8080" }), 200)
	})
	t.Run("missing X-MX", func(t *testing.T) {
		wantStatus(t, do(h, "PUT", "/api/group?name=A", "", func(r *http.Request) { r.Header.Del("X-MX") }), 403)
	})
	t.Run("mismatched origin", func(t *testing.T) {
		wantStatus(t, do(h, "PUT", "/api/group?name=A", "", hdr("Origin", "http://evil.example")), 403)
	})
	t.Run("matching origin", func(t *testing.T) {
		wantStatus(t, do(h, "PUT", "/api/group?name=A", "", hdr("Origin", "http://localhost:8080")), 204)
	})
	t.Run("wrong content type", func(t *testing.T) {
		wantStatus(t, do(h, "PUT", "/api/group?name=B", "", hdr("Content-Type", "text/plain")), 415)
	})
	t.Run("options", func(t *testing.T) {
		wantStatus(t, do(h, "OPTIONS", "/api/tree", "", hdr("Origin", "http://evil.example")), 405)
	})
	t.Run("no cors headers", func(t *testing.T) {
		w := do(h, "GET", "/api/tree", "", hdr("Origin", "http://localhost:8080"))
		wantStatus(t, w, 200)
		for k := range w.Header() {
			if strings.HasPrefix(k, "Access-Control-") {
				t.Errorf("unexpected header %s", k)
			}
		}
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("Cache-Control = %q", got)
		}
		if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q", got)
		}
	})
}

func TestBoardLifecycle(t *testing.T) {
	h := newTestHandler(t)
	wantStatus(t, do(h, "PUT", "/api/group?name=Work", ""), 204)
	q := "group=Work&name=Q3"
	create(t, h, q, scene)

	w := do(h, "GET", "/api/board?"+q, "")
	wantStatus(t, w, 200)
	if w.Body.String() != scene {
		t.Fatalf("body = %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	rev1 := w.Header().Get("ETag")
	if !regexp.MustCompile(`^"\d+-\d+"$`).MatchString(rev1) {
		t.Fatalf("ETag = %q", rev1)
	}

	wantStatus(t, do(h, "PUT", "/api/board?"+q, scene, hdr("If-None-Match", "*")), 409)

	next := `{"type":"excalidraw","version":2,"elements":[{"id":"a"}]}`
	w = do(h, "PUT", "/api/board?"+q, next, hdr("If-Match", rev1))
	wantStatus(t, w, 204)
	rev2 := w.Header().Get("ETag")
	if rev2 == "" || rev2 == rev1 {
		t.Fatalf("new ETag %q, old %q", rev2, rev1)
	}

	w = do(h, "PUT", "/api/board?"+q, scene, hdr("If-Match", rev1))
	wantStatus(t, w, 412)
	if got := w.Header().Get("ETag"); got != rev2 {
		t.Errorf("412 ETag = %q, want %q", got, rev2)
	}

	bare := strings.Trim(rev2, `"`)
	wantStatus(t, do(h, "PUT", "/api/board?"+q, scene, hdr("If-Match", bare)), 204)

	wantStatus(t, do(h, "PATCH", "/api/board?"+q, `{"group":"","name":"Q4"}`), 204)
	wantStatus(t, do(h, "GET", "/api/board?"+q, ""), 404)
	w = do(h, "GET", "/api/board?name=Q4", "")
	wantStatus(t, w, 200)
	if w.Body.String() != scene {
		t.Fatalf("moved body = %q", w.Body.String())
	}

	wantStatus(t, do(h, "DELETE", "/api/board?name=Q4", ""), 204)
	wantStatus(t, do(h, "GET", "/api/board?name=Q4", ""), 404)
	wantStatus(t, do(h, "DELETE", "/api/board?name=Q4", ""), 404)
}

func TestPutBoardRejections(t *testing.T) {
	h := newTestHandler(t)
	cases := []struct {
		name, body string
		mut        []func(*http.Request)
		want       int
	}{
		{"no precondition", scene, nil, 428},
		{"not json", `{"type":`, []func(*http.Request){hdr("If-None-Match", "*")}, 400},
		{"wrong type", `{"type":"other"}`, []func(*http.Request){hdr("If-None-Match", "*")}, 400},
		{"array", `[]`, []func(*http.Request){hdr("If-None-Match", "*")}, 400},
		{"replace missing", scene, []func(*http.Request){hdr("If-Match", `"1-1"`)}, 404},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			wantStatus(t, do(h, "PUT", "/api/board?name=x", c.body, c.mut...), c.want)
		})
	}
	wantStatus(t, do(h, "PUT", "/api/board?name=a%2Fb", scene, hdr("If-None-Match", "*")), 400)
	wantStatus(t, do(h, "PUT", "/api/board?group=Nope&name=x", scene, hdr("If-None-Match", "*")), 404)
}

func TestOversizedBody(t *testing.T) {
	old := maxBody
	maxBody = 64
	t.Cleanup(func() { maxBody = old })
	h := newTestHandler(t)
	big := `{"type":"excalidraw","pad":"` + strings.Repeat("x", 100) + `"}`
	wantStatus(t, do(h, "PUT", "/api/board?name=x", big, hdr("If-None-Match", "*")), 413)
	wantStatus(t, do(h, "PUT", "/api/board?name=x", scene[:40]+"}", hdr("If-None-Match", "*")), 400)
}

func TestGroupOps(t *testing.T) {
	h := newTestHandler(t)
	wantStatus(t, do(h, "PUT", "/api/group?name=A", ""), 204)
	wantStatus(t, do(h, "PUT", "/api/group?name=A", ""), 409)
	wantStatus(t, do(h, "PATCH", "/api/group?name=A", `{"name":"B"}`), 204)
	wantStatus(t, do(h, "PATCH", "/api/group?name=A", `{"name":"C"}`), 404)
	wantStatus(t, do(h, "PATCH", "/api/group?name=B", `{"name":""}`), 400)
	wantStatus(t, do(h, "PATCH", "/api/group?name=B", `nope`), 400)
	wantStatus(t, do(h, "DELETE", "/api/group?name=B", ""), 204)
	wantStatus(t, do(h, "DELETE", "/api/group?name=B", ""), 404)
}

func TestTreeJSON(t *testing.T) {
	h := newTestHandler(t)
	wantStatus(t, do(h, "GET", "/api/tree", ""), 200)
	empty := do(h, "GET", "/api/tree", "").Body.String()
	if empty != `{"groups":[],"ungrouped":[],"last":null}`+"\n" {
		t.Fatalf("empty tree = %q", empty)
	}

	wantStatus(t, do(h, "PUT", "/api/group?name=Work", ""), 204)
	create(t, h, "group=Work&name=Q3", scene)
	create(t, h, "name=x", scene)
	wantStatus(t, do(h, "PUT", "/api/last", `{"group":"Work","name":"Q3"}`), 204)

	got := regexp.MustCompile(`"rev":"[^"]*"`).ReplaceAllString(do(h, "GET", "/api/tree", "").Body.String(), `"rev":"R"`)
	want := `{"groups":[{"name":"Work","boards":[{"name":"Q3","rev":"R"}]}],"ungrouped":[{"name":"x","rev":"R"}],"last":{"group":"Work","name":"Q3"}}` + "\n"
	if got != want {
		t.Fatalf("tree = %s\nwant   %s", got, want)
	}

	wantStatus(t, do(h, "PUT", "/api/last", `null`), 204)
	if body := do(h, "GET", "/api/tree", "").Body.String(); !strings.HasSuffix(body, `"last":null}`+"\n") {
		t.Fatalf("last not cleared: %s", body)
	}
	wantStatus(t, do(h, "PUT", "/api/last", `{"group":"","name":""}`), 400)
}

func TestBootInjection(t *testing.T) {
	h := newTestHandler(t)
	w := do(h, "GET", "/", "")
	wantStatus(t, w, 200)
	if got := w.Body.String(); got != `<html><head><script>window.__BOOT__={"groups":[],"ungrouped":[],"last":null}</script></head><body>app</body></html>` {
		t.Fatalf("empty boot page = %q", got)
	}

	// '/' is not a legal name character, so a literal </script> cannot be named;
	// angle brackets and ampersands still must not reach the page raw.
	wantStatus(t, do(h, "PUT", "/api/group?name=G%26H", ""), 204)
	create(t, h, "group=G%26H&name=%3Cscript%3E%3Cb%3E", scene)
	wantStatus(t, do(h, "PUT", "/api/last", `{"group":"G&H","name":"<script><b>"}`), 204)

	w = do(h, "GET", "/", "")
	wantStatus(t, w, 200)
	body := w.Body.String()
	bs := "\x5c"
	esc := strings.NewReplacer("&", bs+"u0026", "<", bs+"u003c", ">", bs+"u003e")
	wantBoot := `window.__BOOT__={"groups":[{"name":"` + esc.Replace("G&H") + `","boards":[{"name":"` + esc.Replace("<script><b>") + `","rev"`
	if !strings.Contains(body, wantBoot) {
		t.Errorf("boot data missing or unescaped: %s", body)
	}
	if strings.Contains(body, "<b>") || strings.Count(body, "<script>") != 1 {
		t.Errorf("raw markup leaked: %s", body)
	}
	wantLink := `<link rel="preload" as="fetch" crossorigin="anonymous" href="/api/board?group=G%26H&amp;name=%3Cscript%3E%3Cb%3E">`
	if !strings.Contains(body, wantLink) {
		t.Errorf("preload link missing, want %s in %s", wantLink, body)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q", got)
	}
	if got := w.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
}

func TestStaticFiles(t *testing.T) {
	h := newTestHandler(t)
	w := do(h, "GET", "/assets/app.js", "")
	wantStatus(t, w, 200)
	if w.Body.String() != "console.log(1)" {
		t.Errorf("body = %q", w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
	w = do(h, "GET", "/favicon.svg", "")
	wantStatus(t, w, 200)
	if got := w.Header().Get("Cache-Control"); got != "" {
		t.Errorf("non-asset Cache-Control = %q", got)
	}
	wantStatus(t, do(h, "GET", "/index.html", ""), 404)
	wantStatus(t, do(h, "GET", "/assets/missing.js", ""), 404)
	wantStatus(t, do(h, "GET", "/assets/", ""), 404)
}

func TestFontFiles(t *testing.T) {
	h := newTestHandler(t)
	w := do(h, "GET", "/excalidraw/fonts/Virgil/Virgil-abc.woff2", "")
	wantStatus(t, w, 200)
	if got := w.Header().Get("Content-Type"); got != "font/woff2" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := w.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}
