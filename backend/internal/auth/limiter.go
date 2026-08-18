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

type UnlockLimiter struct {
	mu       sync.Mutex
	attempts map[string]attempt
	limit    int
	window   time.Duration
}

func NewUnlockLimiter(limit int, window time.Duration) *UnlockLimiter {
	return &UnlockLimiter{attempts: make(map[string]attempt), limit: limit, window: window}
}

func (l *UnlockLimiter) Allow(key string, now time.Time) bool {
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

func (l *UnlockLimiter) Failure(key string, now time.Time) {
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

func (l *UnlockLimiter) Success(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}
