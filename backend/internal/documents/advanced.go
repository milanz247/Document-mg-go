package documents

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxAssetSize = 10 << 20

var markdownLinkPattern = regexp.MustCompile(`!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)`)

func AssetExtensions() map[string]struct{} {
	return map[string]struct{}{ ".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {}, ".webp": {}, ".svg": {}, ".pdf": {}, ".txt": {}, ".csv": {}, ".json": {}, ".yaml": {}, ".yml": {}, ".zip": {} }
}

func (s *Service) MoveDocument(sourcePath, targetPath string) (Document, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	source, err := s.root.ResolveExisting(sourcePath, map[string]struct{}{ ".md": {} })
	if err != nil { return Document{}, err }
	target, err := s.root.ResolveWriteTarget(targetPath, map[string]struct{}{ ".md": {} })
	if err != nil { return Document{}, err }
	if filepath.Clean(source) == filepath.Clean(target) {
		sourceText, readErr := readDocumentFile(source)
		if readErr != nil { return Document{}, readErr }
		return documentFromSource(filepath.ToSlash(filepath.Clean(sourcePath)), sourceText), nil
	}
	if _, err := os.Lstat(target); err == nil { return Document{}, os.ErrExist } else if !errors.Is(err, os.ErrNotExist) { return Document{}, err }
	if err := os.Rename(source, target); err != nil { return Document{}, err }
	sourceText, err := readDocumentFile(target)
	if err != nil { return Document{}, err }
	return documentFromSource(filepath.ToSlash(filepath.Clean(targetPath)), sourceText), nil
}

func (s *Service) MoveFolder(sourcePath, targetPath string) (string, error) {
	if !utf8.ValidString(targetPath) || utf8.RuneCountInString(targetPath) > 240 { return "", ErrInvalidDocument }
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	source, err := s.root.ResolveExistingDirectory(sourcePath)
	if err != nil { return "", err }
	target, err := s.root.ResolveDirectoryCreateTarget(targetPath)
	if err != nil { return "", err }
	if _, err := os.Lstat(target); err == nil { return "", os.ErrExist } else if !errors.Is(err, os.ErrNotExist) { return "", err }
	relative, err := filepath.Rel(source, target)
	if err != nil || relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) { return "", ErrInvalidDocument }
	if err := os.Rename(source, target); err != nil { return "", err }
	return filepath.ToSlash(filepath.Clean(targetPath)), nil
}

func (s *Service) UploadAsset(documentPath, filename string, source io.Reader) (AssetUpload, error) {
	if filename == "" || !utf8.ValidString(filename) || utf8.RuneCountInString(filename) > 120 || strings.IndexFunc(filename, unicode.IsControl) >= 0 || filepath.Base(filename) != filename || strings.ContainsAny(filename, `/\`) { return AssetUpload{}, ErrInvalidDocument }
	extension := strings.ToLower(filepath.Ext(filename))
	if _, ok := AssetExtensions()[extension]; !ok { return AssetUpload{}, ErrInvalidDocument }
	if _, err := s.root.ResolveExisting(documentPath, map[string]struct{}{ ".md": {} }); err != nil { return AssetUpload{}, err }
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	assetDirectory := filepath.ToSlash(filepath.Join(filepath.Dir(filepath.FromSlash(documentPath)), "assets"))
	directoryTarget, err := s.root.ResolveDirectoryCreateTarget(assetDirectory)
	if err != nil { return AssetUpload{}, err }
	if err := os.Mkdir(directoryTarget, 0o755); err != nil && !errors.Is(err, os.ErrExist) { return AssetUpload{}, err }
	if _, err := s.root.ResolveExistingDirectory(assetDirectory); err != nil { return AssetUpload{}, err }
	relativeTarget := filepath.ToSlash(filepath.Join(assetDirectory, filename))
	target, err := s.root.ResolveWriteTarget(relativeTarget, AssetExtensions())
	if err != nil { return AssetUpload{}, err }
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil { return AssetUpload{}, err }
	written, copyErr := io.Copy(file, io.LimitReader(source, maxAssetSize+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written > maxAssetSize {
		_ = os.Remove(target)
		if written > maxAssetSize { return AssetUpload{}, fmt.Errorf("%w: upload exceeds 10 MiB", ErrInvalidDocument) }
		if copyErr != nil { return AssetUpload{}, copyErr }
		return AssetUpload{}, closeErr
	}
	relativeMarkdownPath := pathpkg.Join("assets", url.PathEscape(filename))
	label := strings.ReplaceAll(filename, "]", `\]`)
	markdown := fmt.Sprintf("[%s](%s)", label, relativeMarkdownPath)
	if extension == ".png" || extension == ".jpg" || extension == ".jpeg" || extension == ".gif" || extension == ".webp" || extension == ".svg" { markdown = fmt.Sprintf("![%s](%s)", strings.TrimSuffix(label, filepath.Ext(filename)), relativeMarkdownPath) }
	return AssetUpload{Path: relativeTarget, Markdown: markdown}, nil
}

func (s *Service) Insights(documentPath string) (Insights, error) {
	current, err := s.Read(documentPath)
	if err != nil { return Insights{}, err }
	result := Insights{Backlinks: []Backlink{}, BrokenLinks: []BrokenLink{}}
	for _, target := range markdownTargets(current.Markdown) {
		resolved, ok := resolveRelativeLink(current.Path, target)
		if !ok { continue }
		extension := strings.ToLower(pathpkg.Ext(resolved)); allowed := AssetExtensions(); kind := "asset"
		if extension == ".md" { allowed = map[string]struct{}{ ".md": {} }; kind = "document" }
		if _, supported := allowed[extension]; !supported { continue }
		if _, err := s.root.ResolveExisting(resolved, allowed); err != nil { result.BrokenLinks = append(result.BrokenLinks, BrokenLink{Target: target, Kind: kind}) }
	}
	err = filepath.WalkDir(s.root.Path(), func(fullPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil { return walkErr }
		if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".md") { return nil }
		relative, err := filepath.Rel(s.root.Path(), fullPath); if err != nil { return err }; path := filepath.ToSlash(relative)
		if strings.EqualFold(path, current.Path) { return nil }
		source, err := readDocumentFile(fullPath); if err != nil { return err }
		for _, target := range markdownTargets(source) { if resolved, ok := resolveRelativeLink(path, target); ok && strings.EqualFold(resolved, current.Path) { document := documentFromSource(path, source); result.Backlinks = append(result.Backlinks, Backlink{Path: path, Title: document.Title}); break } }
		return nil
	})
	return result, err
}

func markdownTargets(markdown string) []string { matches := markdownLinkPattern.FindAllStringSubmatch(markdown, -1); targets := make([]string, 0, len(matches)); for _, match := range matches { if len(match) > 1 { targets = append(targets, strings.Trim(match[1], "<>")) } }; return targets }

func resolveRelativeLink(documentPath, target string) (string, bool) {
	parsed, err := url.Parse(target); if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Path == "" { return "", false }
	decoded, err := url.PathUnescape(parsed.Path); if err != nil { return "", false }
	var resolved string
	if strings.HasPrefix(decoded, "/") { resolved = pathpkg.Clean(strings.TrimPrefix(decoded, "/")) } else { resolved = pathpkg.Clean(pathpkg.Join(pathpkg.Dir(documentPath), decoded)) }
	if resolved == "." || resolved == ".." || strings.HasPrefix(resolved, "../") { return "", false }
	return resolved, true
}
