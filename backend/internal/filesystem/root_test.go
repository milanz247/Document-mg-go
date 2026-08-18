package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveExisting(t *testing.T) {
	tempDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tempDir, "guide.md"), []byte("# Guide"), 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := NewRoot(tempDir)
	if err != nil {
		t.Fatal(err)
	}

	resolved, err := root.ResolveExisting("guide.md", map[string]struct{}{".md": {}})
	if err != nil {
		t.Fatalf("valid path rejected: %v", err)
	}
	if resolved != filepath.Join(tempDir, "guide.md") {
		t.Fatalf("unexpected resolved path: %s", resolved)
	}
}

func TestResolveExistingRejectsTraversalAndExtensions(t *testing.T) {
	root, err := NewRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"../secret.md", "../../etc/passwd", filepath.Join(string(filepath.Separator), "absolute.md")} {
		_, resolveErr := root.ResolveExisting(path, map[string]struct{}{".md": {}})
		if !errors.Is(resolveErr, ErrInvalidPath) && !errors.Is(resolveErr, ErrUnsupportedType) {
			t.Errorf("path %q returned unexpected error: %v", path, resolveErr)
		}
	}

	_, err = root.ResolveExisting("secret.txt", map[string]struct{}{".md": {}})
	if !errors.Is(err, ErrUnsupportedType) {
		t.Fatalf("unsupported extension returned: %v", err)
	}
}

func TestResolveDirectoryCreateTarget(t *testing.T) {
	tempDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(tempDir, "Team"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := NewRoot(tempDir)
	if err != nil {
		t.Fatal(err)
	}

	target, err := root.ResolveDirectoryCreateTarget("Team/Runbooks")
	if err != nil {
		t.Fatalf("valid directory rejected: %v", err)
	}
	if target != filepath.Join(tempDir, "Team", "Runbooks") {
		t.Fatalf("unexpected directory target: %s", target)
	}
	for _, path := range []string{"../outside", "Team/../outside", "/absolute", "Team\\Windows"} {
		if _, resolveErr := root.ResolveDirectoryCreateTarget(path); !errors.Is(resolveErr, ErrInvalidPath) {
			t.Errorf("directory path %q returned unexpected error: %v", path, resolveErr)
		}
	}
}
