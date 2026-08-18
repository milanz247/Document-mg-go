package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthenticated    = errors.New("authentication required")
	ErrInvalidCSRF        = errors.New("invalid CSRF token")
)

type User struct {
	ID       int64  `json:"-"`
	Username string `json:"username"`
}

type Session struct {
	User      User      `json:"user"`
	Token     string    `json:"-"`
	CSRFToken string    `json:"csrfToken"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Service struct {
	db              *sql.DB
	sessionDuration time.Duration
	dummyHash       []byte
}

func Open(databasePath, initialUsername, initialPassword string, sessionDuration time.Duration) (*Service, error) {
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open authentication database: %w", err)
	}
	db.SetMaxOpenConns(1)

	service := &Service{db: db, sessionDuration: sessionDuration}
	if err := service.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := service.bootstrap(initialUsername, initialPassword); err != nil {
		db.Close()
		return nil, err
	}
	service.dummyHash, err = bcrypt.GenerateFromPassword([]byte(randomTokenFallback()), 12)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("prepare password verifier: %w", err)
	}
	return service, nil
}

func (s *Service) Close() error {
	return s.db.Close()
}

func (s *Service) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA journal_mode = WAL`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token_hash TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			csrf_token TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run authentication migration: %w", err)
		}
	}
	return nil
}

func (s *Service) bootstrap(username, password string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return fmt.Errorf("count administrators: %w", err)
	}
	if count > 0 {
		return nil
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("ADMIN_USERNAME is required for initial setup")
	}
	if len(password) < 12 {
		return errors.New("ADMIN_PASSWORD must contain at least 12 characters for initial setup")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return fmt.Errorf("hash initial administrator password: %w", err)
	}
	if _, err := s.db.Exec(`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`, username, string(hash), time.Now().Unix()); err != nil {
		return fmt.Errorf("create initial administrator: %w", err)
	}
	return nil
}

func (s *Service) Login(ctx context.Context, username, password string) (Session, error) {
	var user User
	var passwordHash string
	err := s.db.QueryRowContext(ctx, `SELECT id, username, password_hash FROM users WHERE username = ?`, strings.TrimSpace(username)).Scan(&user.ID, &user.Username, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(password))
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, fmt.Errorf("read administrator: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return Session{}, ErrInvalidCredentials
	}

	return s.createSession(ctx, user)
}

func (s *Service) createSession(ctx context.Context, user User) (Session, error) {
	token, err := randomToken(32)
	if err != nil {
		return Session{}, err
	}
	csrfToken, err := randomToken(32)
	if err != nil {
		return Session{}, err
	}
	expiresAt := time.Now().Add(s.sessionDuration)

	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, time.Now().Unix()); err != nil {
		return Session{}, fmt.Errorf("clean expired sessions: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`, hashToken(token), user.ID, csrfToken, expiresAt.Unix(), time.Now().Unix()); err != nil {
		return Session{}, fmt.Errorf("create session: %w", err)
	}
	return Session{User: user, Token: token, CSRFToken: csrfToken, ExpiresAt: expiresAt}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (Session, error) {
	if token == "" {
		return Session{}, ErrUnauthenticated
	}
	var session Session
	var expiresUnix int64
	err := s.db.QueryRowContext(ctx, `
		SELECT users.id, users.username, sessions.csrf_token, sessions.expires_at
		FROM sessions JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = ? AND sessions.expires_at > ?`, hashToken(token), time.Now().Unix()).
		Scan(&session.User.ID, &session.User.Username, &session.CSRFToken, &expiresUnix)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrUnauthenticated
	}
	if err != nil {
		return Session{}, fmt.Errorf("read session: %w", err)
	}
	session.Token = token
	session.ExpiresAt = time.Unix(expiresUnix, 0)
	return session, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func ValidateCSRF(session Session, provided string) error {
	if provided == "" || !subtleTokenCompare(session.CSRFToken, provided) {
		return ErrInvalidCSRF
	}
	return nil
}

func randomToken(bytes int) (string, error) {
	buffer := make([]byte, bytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate secure token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func randomTokenFallback() string {
	token, err := randomToken(24)
	if err != nil {
		return "atlas-dummy-password-hash-value"
	}
	return token
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func subtleTokenCompare(expected, provided string) bool {
	expectedHash := sha256.Sum256([]byte(expected))
	providedHash := sha256.Sum256([]byte(provided))
	return subtle.ConstantTimeCompare(expectedHash[:], providedHash[:]) == 1
}
