package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"docsportal/backend/internal/auth"
	"docsportal/backend/internal/config"
	"docsportal/backend/internal/documents"
	securefs "docsportal/backend/internal/filesystem"
	appserver "docsportal/backend/internal/server"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	configuration, err := config.Load()
	if err != nil {
		logger.Error("configuration failed", "error", err)
		os.Exit(1)
	}

	root, err := securefs.NewRoot(configuration.DocsRoot)
	if err != nil {
		logger.Error("documentation root failed", "error", err)
		os.Exit(1)
	}
	authService, err := auth.Open(configuration.DatabasePath, configuration.AdminUsername, configuration.AdminPassword, configuration.SessionDuration)
	if err != nil {
		logger.Error("authentication setup failed", "error", err)
		os.Exit(1)
	}
	defer authService.Close()

	httpServer := &http.Server{
		Addr:              configuration.Address,
		Handler:           appserver.New(documents.NewService(root), root, authService, configuration.CookieSecure, logger),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("server listening", "address", configuration.Address, "docs_root", configuration.DocsRoot)
		if serveErr := httpServer.ListenAndServe(); serveErr != nil && serveErr != http.ErrServerClosed {
			logger.Error("server stopped unexpectedly", "error", serveErr)
			os.Exit(1)
		}
	}()

	shutdownSignal, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-shutdownSignal.Done()

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownContext); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
