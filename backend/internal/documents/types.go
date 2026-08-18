package documents

type NavigationNode struct {
	Name     string           `json:"name"`
	Type     string           `json:"type"`
	Path     string           `json:"path"`
	Tags     []string         `json:"tags,omitempty"`
	Children []NavigationNode `json:"children,omitempty"`
}

type Document struct {
	Path     string    `json:"path"`
	Title    string    `json:"title"`
	Tags     []string  `json:"tags"`
	Markdown string    `json:"markdown"`
	Headings []Heading `json:"headings"`
}

type SearchResult struct {
	Path    string   `json:"path"`
	Title   string   `json:"title"`
	Excerpt string   `json:"excerpt"`
	Tags    []string `json:"tags"`
	Score   int      `json:"score"`
}

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
}
