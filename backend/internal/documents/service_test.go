package documents

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	securefs "docsportal/backend/internal/filesystem"
)

func TestNavigationAndDocument(t *testing.T) {
	rootPath := t.TempDir()
	if err := os.Mkdir(filepath.Join(rootPath, "Linux"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.md":                         "# Welcome\n",
		filepath.Join("Linux", "nginx.md"): "# Nginx\n\n## Installation\n",
		"ignored.txt":                      "ignore me",
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(rootPath, path), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	root, err := securefs.NewRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(root)
	navigation, err := service.Navigation()
	if err != nil {
		t.Fatal(err)
	}
	if len(navigation) != 2 || navigation[0].Type != "folder" || navigation[1].Path != "index.md" {
		t.Fatalf("unexpected navigation: %#v", navigation)
	}

	document, err := service.Read("Linux/nginx.md")
	if err != nil {
		t.Fatal(err)
	}
	if document.Title != "Nginx" || len(document.Headings) != 2 {
		t.Fatalf("unexpected document: %#v", document)
	}
}

func TestFrontMatterTagsAndSearch(t *testing.T) {
	rootPath := t.TempDir()
	if err := os.Mkdir(filepath.Join(rootPath, "Operations"), 0o755); err != nil {
		t.Fatal(err)
	}
	source := "---\ntitle: Database Runbook\nowner: platform\ntags:\n  - PostgreSQL\n  - Production\n---\n\n# Recovery\n\nRestore the database from the latest encrypted backup.\n"
	path := filepath.Join(rootPath, "Operations", "database.md")
	if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}

	root, err := securefs.NewRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(root)
	document, err := service.Read("Operations/database.md")
	if err != nil {
		t.Fatal(err)
	}
	if document.Title != "Database Runbook" || strings.Contains(document.Markdown, "tags:") {
		t.Fatalf("unexpected parsed document: %#v", document)
	}
	if len(document.Tags) != 2 || document.Tags[0] != "postgresql" || document.Tags[1] != "production" {
		t.Fatalf("unexpected tags: %#v", document.Tags)
	}
	navigation, err := service.Navigation()
	if err != nil {
		t.Fatal(err)
	}
	if len(navigation) != 1 || len(navigation[0].Children) != 1 || navigation[0].Children[0].Name != "database" {
		t.Fatalf("navigation did not use the filename: %#v", navigation)
	}

	results, err := service.Search("encrypted backup", []string{"production"})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Path != "Operations/database.md" {
		t.Fatalf("unexpected search results: %#v", results)
	}

	updated, err := service.UpdateWithTags("Operations/database.md", document.Markdown+"\nVerified quarterly.\n", []string{"Disaster Recovery"})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Tags) != 1 || updated.Tags[0] != "disaster-recovery" {
		t.Fatalf("unexpected updated tags: %#v", updated.Tags)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "owner: platform") || !strings.Contains(string(raw), "  - disaster-recovery") {
		t.Fatalf("frontmatter was not preserved: %s", raw)
	}
}

func TestCreateUpdateAndDelete(t *testing.T) {
	rootPath := t.TempDir()
	if err := os.Mkdir(filepath.Join(rootPath, "Engineering"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := securefs.NewRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(root)

	created, err := service.Create("Engineering/new-page.md", "# New Page\n")
	if err != nil || created.Title != "New Page" {
		t.Fatalf("create returned %#v, %v", created, err)
	}
	if _, err := service.Create("Engineering/new-page.md", "duplicate"); !os.IsExist(err) {
		t.Fatalf("duplicate create returned %v", err)
	}

	updated, err := service.Update("Engineering/new-page.md", "# Updated Page\n\nContent.\n")
	if err != nil || updated.Title != "Updated Page" {
		t.Fatalf("update returned %#v, %v", updated, err)
	}
	if err := service.Delete("Engineering/new-page.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Read("Engineering/new-page.md"); !os.IsNotExist(err) {
		t.Fatalf("deleted document read returned %v", err)
	}
}

func TestCreateEmptyFolderAppearsInNavigation(t *testing.T) {
	rootPath := t.TempDir()
	if err := os.Mkdir(filepath.Join(rootPath, "Engineering"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := securefs.NewRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(root)
	created, err := service.CreateFolder("Engineering/Runbooks")
	if err != nil {
		t.Fatal(err)
	}
	if created != "Engineering/Runbooks" {
		t.Fatalf("unexpected created folder path: %s", created)
	}
	navigation, err := service.Navigation()
	if err != nil {
		t.Fatal(err)
	}
	if len(navigation) != 1 || len(navigation[0].Children) != 1 || navigation[0].Children[0].Path != "Engineering/Runbooks" {
		t.Fatalf("empty folder missing from navigation: %#v", navigation)
	}
}
