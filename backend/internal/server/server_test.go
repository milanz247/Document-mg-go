package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"docsportal/backend/internal/auth"
	"docsportal/backend/internal/documents"
	securefs "docsportal/backend/internal/filesystem"
)

func TestAuthenticatedDocumentLifecycle(t *testing.T) {
	docsRoot := t.TempDir()
	if err := os.Mkdir(filepath.Join(docsRoot, "Team"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := securefs.NewRoot(docsRoot)
	if err != nil {
		t.Fatal(err)
	}
	authService, err := auth.Open(filepath.Join(t.TempDir(), "auth.db"), "admin", "a-strong-test-password", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer authService.Close()

	handler := New(documents.NewService(root), root, authService, false, slog.New(slog.NewTextHandler(io.Discard, nil)))
	testServer := httptest.NewServer(handler)
	defer testServer.Close()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	response, err := client.Get(testServer.URL + "/api/navigation")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated navigation status = %d", response.StatusCode)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodPost, testServer.URL+"/api/auth/login", map[string]string{
		"username": "admin", "password": "a-strong-test-password",
	}, "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", response.StatusCode)
	}
	var session auth.Session
	if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodPost, testServer.URL+"/api/documents", map[string]any{
		"path": "Team/web-created.md", "markdown": "# Web Created\n", "tags": []string{"Engineering"},
	}, "")
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("missing CSRF status = %d", response.StatusCode)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodPost, testServer.URL+"/api/documents", map[string]any{
		"path": "Team/web-created.md", "markdown": "# Web Created\n", "tags": []string{"Engineering"},
	}, session.CSRFToken)
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("create status = %d, body = %s", response.StatusCode, body)
	}
	response.Body.Close()

	response, err = client.Get(testServer.URL + "/api/search?q=created&tag=engineering")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("search status = %d", response.StatusCode)
	}
	var results []documents.SearchResult
	if err := json.NewDecoder(response.Body).Decode(&results); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if len(results) != 1 || results[0].Path != "Team/web-created.md" {
		t.Fatalf("unexpected search results: %#v", results)
	}

	response = jsonRequest(t, client, http.MethodPost, testServer.URL+"/api/folders", map[string]string{
		"path": "Team/Runbooks",
	}, session.CSRFToken)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("folder create status = %d", response.StatusCode)
	}
	response.Body.Close()
	if info, err := os.Stat(filepath.Join(docsRoot, "Team", "Runbooks")); err != nil || !info.IsDir() {
		t.Fatalf("folder was not created: %v", err)
	}

	response = jsonRequest(t, client, http.MethodPut, testServer.URL+"/api/document", map[string]string{
		"path": "Team/web-created.md", "markdown": "# Updated Online\n",
	}, session.CSRFToken)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("update status = %d", response.StatusCode)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodDelete, testServer.URL+"/api/document?path=..%2Foutside.md", nil, session.CSRFToken)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("traversal delete status = %d", response.StatusCode)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodDelete, testServer.URL+"/api/document?path=Team%2Fweb-created.md", nil, session.CSRFToken)
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d", response.StatusCode)
	}
	response.Body.Close()
}

func jsonRequest(t *testing.T, client *http.Client, method, url string, value any, csrfToken string) *http.Response {
	t.Helper()
	var body io.Reader
	if value != nil {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if value != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if csrfToken != "" {
		request.Header.Set("X-CSRF-Token", csrfToken)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
