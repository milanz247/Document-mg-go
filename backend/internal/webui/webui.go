// Package webui serves the production Vue application bundled into the Go
// executable. The frontend build writes its output into this package's dist
// directory before the Go binary is compiled.
package webui

import (
	"bytes"
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed all:dist
var embedded embed.FS

var files = mustSub(embedded, "dist")

// Handler returns an HTTP handler for embedded static assets. Unknown browser
// paths receive index.html so Vue Router history navigation also works after a
// refresh. Missing fingerprinted assets are returned as 404 responses.
func Handler() http.Handler {
	return http.HandlerFunc(serve)
}

func serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}

	data, err := fs.ReadFile(files, name)
	if err != nil {
		if strings.HasPrefix(name, "assets/") {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		data, err = fs.ReadFile(files, name)
		if err != nil {
			http.Error(w, "Embedded web UI is unavailable", http.StatusServiceUnavailable)
			return
		}
	}

	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func mustSub(source fs.FS, directory string) fs.FS {
	sub, err := fs.Sub(source, directory)
	if err != nil {
		panic(err)
	}
	return sub
}
