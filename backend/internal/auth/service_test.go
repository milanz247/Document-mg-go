package auth

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestUnlockSessionAndLock(t *testing.T) {
	service, err := Open(filepath.Join(t.TempDir(), "auth.db"), "admin", "a-strong-test-password", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	if _, err := service.Unlock(context.Background(), "wrong-password"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("invalid unlock returned %v", err)
	}
	session, err := service.Unlock(context.Background(), "a-strong-test-password")
	if err != nil {
		t.Fatal(err)
	}
	if session.Token == "" || session.CSRFToken == "" || session.User.Username != "admin" {
		t.Fatalf("unexpected session: %#v", session)
	}
	if err := ValidateCSRF(session, "wrong"); !errors.Is(err, ErrInvalidCSRF) {
		t.Fatalf("invalid CSRF returned %v", err)
	}
	if err := ValidateCSRF(session, session.CSRFToken); err != nil {
		t.Fatalf("valid CSRF rejected: %v", err)
	}

	authenticated, err := service.Authenticate(context.Background(), session.Token)
	if err != nil || authenticated.User.Username != "admin" {
		t.Fatalf("authenticate returned %#v, %v", authenticated, err)
	}
	if err := service.Lock(context.Background(), session.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Authenticate(context.Background(), session.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("logged out session returned %v", err)
	}
}

func TestBootstrapRequiresStrongPassword(t *testing.T) {
	service, err := Open(filepath.Join(t.TempDir(), "auth.db"), "admin", "short", time.Hour)
	if service != nil {
		service.Close()
	}
	if err == nil {
		t.Fatal("expected weak initial password to be rejected")
	}
}
