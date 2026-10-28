package main

import (
	"log"
	"sync"
)

var (
	logOnceMu   sync.Mutex
	logOnceLast = make(map[string]string)
)

// logOnce prints msg only when it differs from the last message for key. A
// collector that fails on every poll then logs one line per distinct error.
func logOnce(key, msg string) {
	logOnceMu.Lock()
	if logOnceLast[key] == msg {
		logOnceMu.Unlock()
		return
	}
	logOnceLast[key] = msg
	logOnceMu.Unlock()
	log.Printf("%s", msg)
}
