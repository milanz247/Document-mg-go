package filesystem

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrInvalidPath     = errors.New("invalid document path")
	ErrUnsupportedType = errors.New("unsupported file type")
)

type Root struct {
	path string
}

func NewRoot(path string) (*Root, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve root: %w", err)
	}
	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return nil, fmt.Errorf("evaluate root: %w", err)
	}
	return &Root{path: filepath.Clean(realPath)}, nil
}

func (r *Root) Path() string {
	return r.path
}

// ResolveExisting resolves a user-provided relative path and rejects absolute
// paths, traversal, and symlinks that leave the configured documentation root.
func (r *Root) ResolveExisting(requested string, allowedExtensions map[string]struct{}) (string, error) {
	cleaned, err := cleanRelative(requested, allowedExtensions)
	if err != nil {
		return "", err
	}

	candidate, err := filepath.Abs(filepath.Join(r.path, cleaned))
	if err != nil || !isWithin(r.path, candidate) {
		return "", ErrInvalidPath
	}

	realCandidate, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	if !isWithin(r.path, realCandidate) {
		return "", ErrInvalidPath
	}

	info, err := os.Stat(realCandidate)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", ErrInvalidPath
	}

	return realCandidate, nil
}

// ResolveWriteTarget resolves a Markdown write target. The parent directory
// must already exist, and symlink files are rejected instead of overwritten.
func (r *Root) ResolveWriteTarget(requested string, allowedExtensions map[string]struct{}) (string, error) {
	cleaned, err := cleanRelative(requested, allowedExtensions)
	if err != nil {
		return "", err
	}

	parentCandidate, err := filepath.Abs(filepath.Join(r.path, filepath.Dir(cleaned)))
	if err != nil || !isWithin(r.path, parentCandidate) {
		return "", ErrInvalidPath
	}
	realParent, err := filepath.EvalSymlinks(parentCandidate)
	if err != nil {
		return "", err
	}
	if !isWithin(r.path, realParent) {
		return "", ErrInvalidPath
	}
	parentInfo, err := os.Stat(realParent)
	if err != nil {
		return "", err
	}
	if !parentInfo.IsDir() {
		return "", ErrInvalidPath
	}

	target := filepath.Join(realParent, filepath.Base(cleaned))
	if !isWithin(r.path, target) {
		return "", ErrInvalidPath
	}
	if info, lstatErr := os.Lstat(target); lstatErr == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", ErrInvalidPath
		}
	} else if !errors.Is(lstatErr, os.ErrNotExist) {
		return "", lstatErr
	}
	return target, nil
}

// ResolveDirectoryCreateTarget resolves a new directory path beneath the
// documentation root. Its parent must already exist and symlinks are never
// followed as writable directory targets.
func (r *Root) ResolveDirectoryCreateTarget(requested string) (string, error) {
	cleaned, err := cleanDirectoryRelative(requested)
	if err != nil {
		return "", err
	}

	parentCandidate, err := filepath.Abs(filepath.Join(r.path, filepath.Dir(cleaned)))
	if err != nil || !isWithin(r.path, parentCandidate) {
		return "", ErrInvalidPath
	}
	realParent, err := filepath.EvalSymlinks(parentCandidate)
	if err != nil {
		return "", err
	}
	if !isWithin(r.path, realParent) {
		return "", ErrInvalidPath
	}
	parentInfo, err := os.Stat(realParent)
	if err != nil {
		return "", err
	}
	if !parentInfo.IsDir() {
		return "", ErrInvalidPath
	}

	target := filepath.Join(realParent, filepath.Base(cleaned))
	if !isWithin(r.path, target) {
		return "", ErrInvalidPath
	}
	if info, lstatErr := os.Lstat(target); lstatErr == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", ErrInvalidPath
		}
	} else if !errors.Is(lstatErr, os.ErrNotExist) {
		return "", lstatErr
	}
	return target, nil
}

func cleanRelative(requested string, allowedExtensions map[string]struct{}) (string, error) {
	if requested == "" || strings.ContainsRune(requested, '\x00') || strings.Contains(requested, "\\") {
		return "", ErrInvalidPath
	}
	nativePath := filepath.FromSlash(requested)
	if filepath.IsAbs(nativePath) || filepath.VolumeName(nativePath) != "" || strings.HasPrefix(nativePath, string(filepath.Separator)) {
		return "", ErrInvalidPath
	}
	cleaned := filepath.Clean(nativePath)
	if cleaned == "." {
		return "", ErrInvalidPath
	}
	if _, ok := allowedExtensions[strings.ToLower(filepath.Ext(cleaned))]; !ok {
		return "", ErrUnsupportedType
	}
	return cleaned, nil
}

func cleanDirectoryRelative(requested string) (string, error) {
	if requested == "" || strings.ContainsRune(requested, '\x00') || strings.Contains(requested, "\\") {
		return "", ErrInvalidPath
	}
	nativePath := filepath.FromSlash(requested)
	if filepath.IsAbs(nativePath) || filepath.VolumeName(nativePath) != "" || strings.HasPrefix(nativePath, string(filepath.Separator)) {
		return "", ErrInvalidPath
	}
	for _, segment := range strings.Split(requested, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", ErrInvalidPath
		}
	}
	cleaned := filepath.Clean(nativePath)
	if cleaned == "." {
		return "", ErrInvalidPath
	}
	return cleaned, nil
}

func isWithin(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	if err != nil || filepath.IsAbs(relative) {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
