package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Address         string
	DocsRoot        string
	DatabasePath    string
	AdminUsername   string
	AdminPassword   string
	CookieSecure    bool
	SessionDuration time.Duration
}

func Load() (Config, error) {
	_, docsFromProcess := os.LookupEnv("DOCS_ROOT")
	_, dataFromProcess := os.LookupEnv("APP_DATA_DIR")
	envDir, err := loadDotEnvFromAncestors()
	if err != nil {
		return Config{}, err
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return Config{}, fmt.Errorf("resolve working directory: %w", err)
	}

	root := os.Getenv("DOCS_ROOT")
	if root == "" {
		root = "../docs"
	}
	docsBase := workingDir
	if envDir != "" && !docsFromProcess {
		docsBase = envDir
	}
	absRoot, err := absoluteFrom(docsBase, root)
	if err != nil {
		return Config{}, fmt.Errorf("resolve DOCS_ROOT: %w", err)
	}
	info, err := os.Stat(absRoot)
	if err != nil {
		return Config{}, fmt.Errorf("inspect DOCS_ROOT: %w", err)
	}
	if !info.IsDir() {
		return Config{}, fmt.Errorf("DOCS_ROOT is not a directory")
	}

	address := os.Getenv("SERVER_ADDRESS")
	if address == "" {
		address = ":18080"
	}

	appDataDir := os.Getenv("APP_DATA_DIR")
	if appDataDir == "" {
		appDataDir = "../data"
	}
	dataBase := workingDir
	if envDir != "" && !dataFromProcess {
		dataBase = envDir
	}
	absDataDir, err := absoluteFrom(dataBase, appDataDir)
	if err != nil {
		return Config{}, fmt.Errorf("resolve APP_DATA_DIR: %w", err)
	}
	if err := os.MkdirAll(absDataDir, 0o700); err != nil {
		return Config{}, fmt.Errorf("create APP_DATA_DIR: %w", err)
	}

	cookieSecure := false
	if raw := os.Getenv("COOKIE_SECURE"); raw != "" {
		cookieSecure, err = strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("parse COOKIE_SECURE: %w", err)
		}
	}

	sessionDuration := 12 * time.Hour
	if raw := os.Getenv("SESSION_DURATION"); raw != "" {
		sessionDuration, err = time.ParseDuration(raw)
		if err != nil || sessionDuration < 5*time.Minute {
			return Config{}, fmt.Errorf("SESSION_DURATION must be at least 5m")
		}
	}

	adminUsername := os.Getenv("ADMIN_USERNAME")
	if adminUsername == "" {
		adminUsername = "admin"
	}

	return Config{
		Address:         address,
		DocsRoot:        absRoot,
		DatabasePath:    filepath.Join(absDataDir, "atlas.db"),
		AdminUsername:   adminUsername,
		AdminPassword:   os.Getenv("ADMIN_PASSWORD"),
		CookieSecure:    cookieSecure,
		SessionDuration: sessionDuration,
	}, nil
}

// loadDotEnvFromAncestors finds the nearest .env file, beginning at the
// current directory. This keeps local configuration stable when the command is
// invoked from backend, backend/cmd/server, or another nested backend folder.
func loadDotEnvFromAncestors() (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve working directory for .env: %w", err)
	}
	for {
		candidate := filepath.Join(directory, ".env")
		info, statErr := os.Stat(candidate)
		if statErr == nil && info.Mode().IsRegular() {
			if err := godotenv.Load(candidate); err != nil {
				return "", fmt.Errorf("load .env: %w", err)
			}
			return directory, nil
		}
		if statErr != nil && !os.IsNotExist(statErr) {
			return "", fmt.Errorf("inspect .env: %w", statErr)
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", nil
		}
		directory = parent
	}
}

func absoluteFrom(base, value string) (string, error) {
	if filepath.IsAbs(value) {
		return filepath.Clean(value), nil
	}
	return filepath.Abs(filepath.Join(base, value))
}
