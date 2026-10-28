package main

import (
	"sync"
	"time"
)

// Cache holds one value with a TTL. It has a single lock for all readers and
// writers, so no caller can read a value that another caller is replacing.
type Cache[T any] struct {
	ttl time.Duration

	mu    sync.Mutex
	value T
	at    time.Time
	ready bool

	loadMu sync.Mutex
}

func newCache[T any](ttl time.Duration) *Cache[T] {
	return &Cache[T]{ttl: ttl}
}

// Get returns the cached value while it is fresh. Otherwise it runs load once
// for all callers and caches the result. A failed load caches the zero value,
// so a failed refresh never leaves old measurements looking current.
func (c *Cache[T]) Get(load func() (T, bool)) T {
	c.mu.Lock()
	if c.ready && time.Since(c.at) < c.ttl {
		v := c.value
		c.mu.Unlock()
		return v
	}
	c.mu.Unlock()

	// Serialize loads. Invalidate never takes this lock, so a refresh never
	// waits for a slow network collector.
	c.loadMu.Lock()
	defer c.loadMu.Unlock()

	c.mu.Lock()
	if c.ready && time.Since(c.at) < c.ttl {
		v := c.value
		c.mu.Unlock()
		return v
	}
	c.mu.Unlock()

	v, ok := load()
	c.mu.Lock()
	if !ok {
		var zero T
		v = zero
	}
	c.value = v
	c.at = time.Now()
	c.ready = true
	c.mu.Unlock()
	return v
}

// Invalidate drops the value and marks the cache empty. It never blocks on an
// in-flight load, so a refresh does not wait for a slow network collector.
func (c *Cache[T]) Invalidate() {
	c.mu.Lock()
	var zero T
	c.value = zero
	c.at = time.Time{}
	c.ready = false
	c.mu.Unlock()
}

// peek returns the cached value without loading it. Tests use it.
func (c *Cache[T]) peek() T {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.value
}

func (c *Cache[T]) isFresh() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ready && time.Since(c.at) < c.ttl
}

// setForTest stores a value as freshly loaded. Tests use it.
func (c *Cache[T]) setForTest(v T) {
	c.mu.Lock()
	c.value = v
	c.at = time.Now()
	c.ready = true
	c.mu.Unlock()
}

// setStale stores a value that the next Get must replace. Tests use it.
func (c *Cache[T]) setStale(v T) {
	c.mu.Lock()
	c.value = v
	c.at = time.Time{}
	c.ready = true
	c.mu.Unlock()
}
