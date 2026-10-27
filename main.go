package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

func main() {
	initConfig()
	initStaticData()
	log.Printf("Starting monit Go server on port %d...", cfg.Port)
	collectAll()
	server := &http.Server{
		Handler:      dashboardHandler(),
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("Dashboard → http://localhost:%d", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}
