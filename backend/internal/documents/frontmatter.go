package documents

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxTags      = 8
	maxTagLength = 32
)

var tagSeparatorPattern = regexp.MustCompile(`[^\pL\pN]+`)

type frontMatter struct {
	Present bool
	Title   string
	Tags    []string
	Header  []string
}

func splitFrontMatter(source string) (frontMatter, string) {
	normalized := strings.ReplaceAll(source, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) < 3 || strings.TrimSpace(lines[0]) != "---" {
		return frontMatter{}, normalized
	}

	end := -1
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index]) == "---" {
			end = index
			break
		}
	}
	if end < 0 {
		return frontMatter{}, normalized
	}

	header := append([]string(nil), lines[1:end]...)
	metadata := frontMatter{Present: true, Header: header}
	for index := 0; index < len(header); index++ {
		line := strings.TrimSpace(header[index])
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "title":
			metadata.Title = unquoteMetadata(value)
		case "tags":
			metadata.Tags = parseTagValue(value)
			for next := index + 1; next < len(header); next++ {
				trimmed := strings.TrimSpace(header[next])
				if !strings.HasPrefix(trimmed, "-") {
					break
				}
				metadata.Tags = append(metadata.Tags, unquoteMetadata(strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))))
				index = next
			}
		}
	}
	metadata.Tags, _ = normalizeTags(metadata.Tags)
	body := strings.Join(lines[end+1:], "\n")
	body = strings.TrimPrefix(body, "\n")
	return metadata, body
}

func composeWithTags(header []string, body string, tags []string) (string, error) {
	normalizedTags, err := normalizeTags(tags)
	if err != nil {
		return "", err
	}
	updated := removeMetadataField(header, "tags")
	if len(normalizedTags) > 0 {
		if len(updated) > 0 && strings.TrimSpace(updated[len(updated)-1]) != "" {
			updated = append(updated, "")
		}
		updated = append(updated, "tags:")
		for _, tag := range normalizedTags {
			updated = append(updated, "  - "+tag)
		}
	}
	updated = trimBlankLines(updated)
	body = strings.TrimLeft(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	if len(updated) == 0 {
		return body, nil
	}
	return "---\n" + strings.Join(updated, "\n") + "\n---\n\n" + body, nil
}

func removeMetadataField(header []string, field string) []string {
	result := make([]string, 0, len(header))
	for index := 0; index < len(header); index++ {
		line := header[index]
		trimmed := strings.TrimSpace(line)
		key, _, found := strings.Cut(trimmed, ":")
		if !found || !strings.EqualFold(strings.TrimSpace(key), field) {
			result = append(result, line)
			continue
		}

		indent := leadingWhitespace(line)
		for index+1 < len(header) {
			next := header[index+1]
			if strings.TrimSpace(next) == "" {
				break
			}
			if leadingWhitespace(next) <= indent {
				break
			}
			index++
		}
	}
	return result
}

func normalizeTags(tags []string) ([]string, error) {
	if len(tags) > maxTags {
		return nil, fmt.Errorf("%w: a document can have at most %d tags", ErrInvalidDocument, maxTags)
	}
	normalized := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, raw := range tags {
		tag := strings.ToLower(strings.TrimSpace(raw))
		tag = strings.Trim(tagSeparatorPattern.ReplaceAllString(tag, "-"), "-")
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > maxTagLength {
			return nil, fmt.Errorf("%w: tags can contain at most %d characters", ErrInvalidDocument, maxTagLength)
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		normalized = append(normalized, tag)
	}
	return normalized, nil
}

func parseTagValue(value string) []string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		value = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(value, "["), "]"))
	}
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	for index := range parts {
		parts[index] = unquoteMetadata(parts[index])
	}
	return parts
}

func unquoteMetadata(value string) string {
	return strings.Trim(strings.TrimSpace(value), "\"'")
}

func leadingWhitespace(value string) int {
	return len(value) - len(strings.TrimLeftFunc(value, unicode.IsSpace))
}

func trimBlankLines(lines []string) []string {
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}
