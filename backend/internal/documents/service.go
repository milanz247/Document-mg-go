package documents

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	securefs "docsportal/backend/internal/filesystem"
)

const (
	maxDocumentSize      = 10 << 20
	maxSearchQueryLength = 200
	maxSearchResults     = 100
)

var (
	headingPattern             = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*\s*$`)
	markdownPunctuationPattern = regexp.MustCompile("[#*_`>\\[\\]()~|]+")
	ErrInvalidDocument         = errors.New("invalid Markdown document")
	ErrInvalidSearch           = errors.New("invalid search")
)

type Service struct {
	root    *securefs.Root
	writeMu sync.Mutex
}

func NewService(root *securefs.Root) *Service {
	return &Service{root: root}
}

func (s *Service) Navigation() ([]NavigationNode, error) {
	return s.scanDirectory(s.root.Path(), "")
}

func (s *Service) scanDirectory(directory, relativeDirectory string) ([]NavigationNode, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("read documentation directory: %w", err)
	}

	nodes := make([]NavigationNode, 0, len(entries))
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}

		relativePath := filepath.Join(relativeDirectory, entry.Name())
		fullPath := filepath.Join(directory, entry.Name())
		if entry.IsDir() {
			children, scanErr := s.scanDirectory(fullPath, relativePath)
			if scanErr != nil {
				return nil, scanErr
			}
			if len(children) == 0 {
				childEntries, readErr := os.ReadDir(fullPath)
				if readErr != nil {
					return nil, fmt.Errorf("read documentation directory: %w", readErr)
				}
				if len(childEntries) > 0 {
					continue
				}
			}
			nodes = append(nodes, NavigationNode{
				Name: readableName(entry.Name()), Type: "folder",
				Path: filepath.ToSlash(relativePath), Children: children,
			})
			continue
		}

		if !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			continue
		}
		source, readErr := readDocumentFile(fullPath)
		if readErr != nil {
			return nil, readErr
		}
		document := documentFromSource(filepath.ToSlash(relativePath), source)
		nodes = append(nodes, NavigationNode{
			Name: document.Title, Type: "document", Path: document.Path, Tags: document.Tags,
		})
	}

	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].Type != nodes[j].Type {
			return nodes[i].Type == "folder"
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
	return nodes, nil
}

func (s *Service) Read(path string) (Document, error) {
	resolved, err := s.root.ResolveExisting(path, map[string]struct{}{".md": {}})
	if err != nil {
		return Document{}, err
	}
	source, err := readDocumentFile(resolved)
	if err != nil {
		return Document{}, err
	}
	return documentFromSource(filepath.ToSlash(filepath.Clean(path)), source), nil
}

func (s *Service) Create(path, markdown string) (Document, error) {
	return s.CreateWithTags(path, markdown, nil)
}

func (s *Service) CreateWithTags(path, markdown string, tags []string) (Document, error) {
	metadata, body := splitFrontMatter(markdown)
	if tags == nil {
		tags = metadata.Tags
	}
	content, err := composeWithTags(metadata.Header, body, tags)
	if err != nil {
		return Document{}, err
	}
	if err := validateMarkdown(content); err != nil {
		return Document{}, err
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	target, err := s.root.ResolveWriteTarget(path, map[string]struct{}{".md": {}})
	if err != nil {
		return Document{}, err
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return Document{}, err
	}
	if _, err = file.WriteString(content); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		_ = os.Remove(target)
		return Document{}, fmt.Errorf("write document: %w", err)
	}
	if closeErr != nil {
		_ = os.Remove(target)
		return Document{}, fmt.Errorf("close document: %w", closeErr)
	}
	return s.Read(path)
}

func (s *Service) Update(path, markdown string) (Document, error) {
	return s.UpdateWithTags(path, markdown, nil)
}

func (s *Service) UpdateWithTags(path, markdown string, tags []string) (Document, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	target, err := s.root.ResolveWriteTarget(path, map[string]struct{}{".md": {}})
	if err != nil {
		return Document{}, err
	}

	existingSource, err := readDocumentFile(target)
	if err != nil {
		return Document{}, err
	}
	existingMetadata, _ := splitFrontMatter(existingSource)
	submittedMetadata, body := splitFrontMatter(markdown)
	header := existingMetadata.Header
	if submittedMetadata.Present {
		header = submittedMetadata.Header
	}
	if tags == nil {
		tags = existingMetadata.Tags
		if submittedMetadata.Present {
			tags = submittedMetadata.Tags
		}
	}
	content, err := composeWithTags(header, body, tags)
	if err != nil {
		return Document{}, err
	}
	if err := validateMarkdown(content); err != nil {
		return Document{}, err
	}

	file, err := os.OpenFile(target, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return Document{}, err
	}
	if _, err = file.WriteString(content); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return Document{}, fmt.Errorf("write document: %w", err)
	}
	if closeErr != nil {
		return Document{}, fmt.Errorf("close document: %w", closeErr)
	}
	return s.Read(path)
}

func (s *Service) Delete(path string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	target, err := s.root.ResolveWriteTarget(path, map[string]struct{}{".md": {}})
	if err != nil {
		return err
	}
	if _, err := os.Stat(target); err != nil {
		return err
	}
	return os.Remove(target)
}

func (s *Service) CreateFolder(path string) (string, error) {
	if !utf8.ValidString(path) || utf8.RuneCountInString(path) > 240 {
		return "", fmt.Errorf("%w: invalid folder path", ErrInvalidDocument)
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	target, err := s.root.ResolveDirectoryCreateTarget(path)
	if err != nil {
		return "", err
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		return "", err
	}
	relative, err := filepath.Rel(s.root.Path(), target)
	if err != nil {
		return "", fmt.Errorf("resolve created folder: %w", err)
	}
	return filepath.ToSlash(relative), nil
}

func (s *Service) Search(query string, tags []string) ([]SearchResult, error) {
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > maxSearchQueryLength {
		return nil, fmt.Errorf("%w: query can contain at most %d characters", ErrInvalidSearch, maxSearchQueryLength)
	}
	normalizedTags, err := normalizeTags(tags)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid tag filter", ErrInvalidSearch)
	}
	if query == "" && len(normalizedTags) == 0 {
		return []SearchResult{}, nil
	}

	terms := strings.Fields(strings.ToLower(query))
	results := make([]SearchResult, 0)
	err = filepath.WalkDir(s.root.Path(), func(fullPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			return nil
		}
		relativePath, relErr := filepath.Rel(s.root.Path(), fullPath)
		if relErr != nil {
			return relErr
		}
		source, readErr := readDocumentFile(fullPath)
		if readErr != nil {
			return readErr
		}
		document := documentFromSource(filepath.ToSlash(relativePath), source)
		if !containsAllTags(document.Tags, normalizedTags) {
			return nil
		}
		score, matches := searchScore(document, terms)
		if !matches {
			return nil
		}
		results = append(results, SearchResult{
			Path: document.Path, Title: document.Title, Tags: document.Tags,
			Excerpt: searchExcerpt(document.Markdown, terms), Score: score,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("search documentation: %w", err)
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		return strings.ToLower(results[i].Title) < strings.ToLower(results[j].Title)
	})
	if len(results) > maxSearchResults {
		results = results[:maxSearchResults]
	}
	return results, nil
}

func validateMarkdown(markdown string) error {
	if len(markdown) > maxDocumentSize {
		return fmt.Errorf("%w: document exceeds %d bytes", ErrInvalidDocument, maxDocumentSize)
	}
	if !utf8.ValidString(markdown) {
		return fmt.Errorf("%w: document must contain valid UTF-8", ErrInvalidDocument)
	}
	return nil
}

func readDocumentFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxDocumentSize+1))
	if err != nil {
		return "", fmt.Errorf("read document: %w", err)
	}
	if len(content) > maxDocumentSize {
		return "", fmt.Errorf("document exceeds %d bytes", maxDocumentSize)
	}
	if !utf8.Valid(content) {
		return "", fmt.Errorf("%w: document must contain valid UTF-8", ErrInvalidDocument)
	}
	return string(content), nil
}

func documentFromSource(path, source string) Document {
	metadata, markdown := splitFrontMatter(source)
	if metadata.Tags == nil {
		metadata.Tags = []string{}
	}
	headings := extractHeadings(markdown)
	title := metadata.Title
	if title == "" {
		for _, heading := range headings {
			if heading.Level == 1 {
				title = heading.Text
				break
			}
		}
	}
	if title == "" {
		base := filepath.Base(path)
		title = readableName(strings.TrimSuffix(base, filepath.Ext(base)))
	}
	return Document{
		Path: filepath.ToSlash(filepath.Clean(path)), Title: title, Tags: metadata.Tags,
		Markdown: markdown, Headings: headings,
	}
}

func containsAllTags(documentTags, filters []string) bool {
	if len(filters) == 0 {
		return true
	}
	available := make(map[string]struct{}, len(documentTags))
	for _, tag := range documentTags {
		available[tag] = struct{}{}
	}
	for _, filter := range filters {
		if _, exists := available[filter]; !exists {
			return false
		}
	}
	return true
}

func searchScore(document Document, terms []string) (int, bool) {
	if len(terms) == 0 {
		return 1, true
	}
	title := strings.ToLower(document.Title)
	pathText := strings.ToLower(document.Path)
	tagText := strings.ToLower(strings.Join(document.Tags, " "))
	headingText := make([]string, 0, len(document.Headings))
	for _, heading := range document.Headings {
		headingText = append(headingText, heading.Text)
	}
	headings := strings.ToLower(strings.Join(headingText, " "))
	body := strings.ToLower(document.Markdown)
	all := title + "\n" + pathText + "\n" + tagText + "\n" + headings + "\n" + body
	score := 0
	for _, term := range terms {
		if !strings.Contains(all, term) {
			return 0, false
		}
		score += strings.Count(title, term)*12 + strings.Count(tagText, term)*8 + strings.Count(pathText, term)*6
		score += strings.Count(headings, term)*4 + strings.Count(body, term)
	}
	return score, true
}

func searchExcerpt(markdown string, terms []string) string {
	lines := strings.Split(markdown, "\n")
	candidate := ""
	for _, line := range lines {
		plain := cleanExcerpt(line)
		if plain == "" {
			continue
		}
		if candidate == "" {
			candidate = plain
		}
		lower := strings.ToLower(plain)
		for _, term := range terms {
			if strings.Contains(lower, term) {
				return truncateRunes(plain, 180)
			}
		}
	}
	return truncateRunes(candidate, 180)
}

func cleanExcerpt(value string) string {
	value = markdownPunctuationPattern.ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func extractHeadings(markdown string) []Heading {
	headings := make([]Heading, 0)
	scanner := bufio.NewScanner(strings.NewReader(markdown))
	inFence := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		matches := headingPattern.FindStringSubmatch(line)
		if len(matches) == 3 {
			headings = append(headings, Heading{Level: len(matches[1]), Text: matches[2]})
		}
	}
	return headings
}

func readableName(value string) string {
	value = strings.NewReplacer("-", " ", "_", " ").Replace(value)
	words := strings.Fields(value)
	for index, word := range words {
		runes := []rune(word)
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
		}
		words[index] = string(runes)
	}
	return strings.Join(words, " ")
}
