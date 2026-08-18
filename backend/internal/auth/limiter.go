package auth

import (
	"sync"
	"time"
)

type attempt struct {
	count        int
	windowStart  time.Time
	blockedUntil time.Time
}

type LoginLimiter struct {
	mu       sync.Mutex
	attempts map[string]attempt
	limit    int
	window   time.Duration
}

func NewLoginLimiter(limit int, window time.Duration) *LoginLimiter {
	return &LoginLimiter{attempts: make(map[string]attempt), limit: limit, window: window}
}

func (l *LoginLimiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.attempts[key]
	if now.Before(entry.blockedUntil) {
		return false
	}
	if entry.windowStart.IsZero() || now.Sub(entry.windowStart) >= l.window {
		delete(l.attempts, key)
	}
	return true
}

func (l *LoginLimiter) Failure(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.attempts[key]
	if entry.windowStart.IsZero() || now.Sub(entry.windowStart) >= l.window {
		entry = attempt{windowStart: now}
	}
	entry.count++
	if entry.count >= l.limit {
		entry.blockedUntil = now.Add(l.window)
	}
	l.attempts[key] = entry
}

func (l *LoginLimiter) Success(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}
