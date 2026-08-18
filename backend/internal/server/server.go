package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"docsportal/backend/internal/auth"
	"docsportal/backend/internal/documents"
	securefs "docsportal/backend/internal/filesystem"
	"docsportal/backend/internal/webui"
)

const (
	sessionCookieName = "atlas_session"
	maxJSONBody       = 11 << 20
)

type contextKey string

const sessionContextKey contextKey = "session"

type Server struct {
	documents    *documents.Service
	root         *securefs.Root
	auth         *auth.Service
	unlockLimiter *auth.UnlockLimiter
	cookieSecure bool
	logger       *slog.Logger
}

type unlockRequest struct {
	Password string `json:"password"`
}

type documentWriteRequest struct {
	Path     string   `json:"path"`
	Markdown string   `json:"markdown"`
	Tags     []string `json:"tags"`
}

type folderCreateRequest struct {
	Path string `json:"path"`
}

type moveRequest struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

func New(documentService *documents.Service, root *securefs.Root, authService *auth.Service, cookieSecure bool, logger *slog.Logger) http.Handler {
	server := &Server{
		documents: documentService, root: root, auth: authService,
		unlockLimiter: auth.NewUnlockLimiter(5, 15*time.Minute),
		cookieSecure: cookieSecure, logger: logger,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", server.health)
	mux.HandleFunc("POST /api/auth/unlock", server.unlock)
	mux.Handle("GET /api/auth/me", server.requireAuth(http.HandlerFunc(server.me)))
	mux.Handle("POST /api/auth/lock", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.lock))))
	mux.HandleFunc("GET /api/navigation", server.navigation)
	mux.HandleFunc("GET /api/search", server.search)
	mux.HandleFunc("GET /api/document", server.document)
	mux.HandleFunc("GET /api/insights", server.insights)
	mux.Handle("POST /api/documents", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.createDocument))))
	mux.Handle("POST /api/folders", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.createFolder))))
	mux.Handle("DELETE /api/folder", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.deleteFolder))))
	mux.Handle("PUT /api/document", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.updateDocument))))
	mux.Handle("DELETE /api/document", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.deleteDocument))))
	mux.Handle("POST /api/move", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.move))))
	mux.Handle("POST /api/assets/upload", server.requireAuth(server.requireCSRF(http.HandlerFunc(server.uploadAsset))))
	mux.HandleFunc("GET /api/assets", server.asset)
	mux.HandleFunc("/api", apiNotFound)
	mux.HandleFunc("/api/", apiNotFound)
	mux.Handle("/", webui.Handler())
	return server.recoverPanic(server.securityHeaders(server.logRequests(mux)))
}

func apiNotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "API endpoint not found")
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) unlock(w http.ResponseWriter, r *http.Request) {
	clientKey := clientIP(r)
	if !s.unlockLimiter.Allow(clientKey, time.Now()) {
		writeError(w, http.StatusTooManyRequests, "Too many unlock attempts. Try again later.")
		return
	}

	var request unlockRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	session, err := s.auth.Unlock(r.Context(), request.Password)
	if errors.Is(err, auth.ErrInvalidPassword) {
		s.unlockLimiter.Failure(clientKey, time.Now())
		writeError(w, http.StatusUnauthorized, "Invalid password")
		return
	}
	if err != nil {
		s.logger.Error("editing unlock failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to unlock editing")
		return
	}
	s.unlockLimiter.Success(clientKey)
	s.setSessionCookie(w, session.Token, session.ExpiresAt)
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, sessionFromContext(r.Context()))
}

func (s *Server) lock(w http.ResponseWriter, r *http.Request) {
	session := sessionFromContext(r.Context())
	if err := s.auth.Lock(r.Context(), session.Token); err != nil {
		s.logger.Error("editing lock failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to lock editing")
		return
	}
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) navigation(w http.ResponseWriter, _ *http.Request) {
	navigation, err := s.documents.Navigation()
	if err != nil {
		s.logger.Error("navigation scan failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to scan documentation")
		return
	}
	writeJSON(w, http.StatusOK, navigation)
}

func (s *Server) document(w http.ResponseWriter, r *http.Request) {
	document, err := s.documents.Read(r.URL.Query().Get("path"))
	if err != nil {
		s.writeFileError(w, err, "Document not found")
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	results, err := s.documents.Search(r.URL.Query().Get("q"), r.URL.Query()["tag"])
	if errors.Is(err, documents.ErrInvalidSearch) {
		writeError(w, http.StatusBadRequest, "Invalid search query")
		return
	}
	if err != nil {
		s.logger.Error("document search failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to search documents")
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) insights(w http.ResponseWriter, r *http.Request) {
	insights, err := s.documents.Insights(r.URL.Query().Get("path"))
	if err != nil {
		s.writeFileError(w, err, "Document not found")
		return
	}
	writeJSON(w, http.StatusOK, insights)
}

func (s *Server) createDocument(w http.ResponseWriter, r *http.Request) {
	var request documentWriteRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	document, err := s.documents.CreateWithTags(request.Path, request.Markdown, request.Tags)
	if err != nil {
		s.writeMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, document)
}

func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	var request folderCreateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	path, err := s.documents.CreateFolder(request.Path)
	if err != nil {
		s.writeFolderMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"path": path})
}

func (s *Server) deleteFolder(w http.ResponseWriter, r *http.Request) {
	if err := s.documents.DeleteFolder(r.URL.Query().Get("path")); err != nil {
		s.writeFolderMutationError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) updateDocument(w http.ResponseWriter, r *http.Request) {
	var request documentWriteRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	document, err := s.documents.UpdateWithTags(request.Path, request.Markdown, request.Tags)
	if err != nil {
		s.writeMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	if err := s.documents.Delete(r.URL.Query().Get("path")); err != nil {
		s.writeMutationError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) move(w http.ResponseWriter, r *http.Request) {
	var request moveRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	if request.Type == "document" {
		document, err := s.documents.MoveDocument(request.Source, request.Target)
		if err != nil { s.writeMutationError(w, err); return }
		writeJSON(w, http.StatusOK, document)
		return
	}
	if request.Type == "folder" {
		path, err := s.documents.MoveFolder(request.Source, request.Target)
		if err != nil { s.writeFolderMutationError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]string{"path": path})
		return
	}
	writeError(w, http.StatusBadRequest, "Invalid move type")
}

func (s *Server) uploadAsset(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 11<<20)
	upload, err := s.documents.UploadAsset(r.URL.Query().Get("document"), r.URL.Query().Get("filename"), r.Body)
	if err != nil { s.writeUploadError(w, err); return }
	writeJSON(w, http.StatusCreated, upload)
}

func (s *Server) asset(w http.ResponseWriter, r *http.Request) {
	allowed := documents.AssetExtensions()
	resolved, err := s.root.ResolveExisting(r.URL.Query().Get("path"), allowed)
	if err != nil {
		s.writeFileError(w, err, "Asset not found")
		return
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(resolved)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, resolved)
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		session, err := s.auth.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			s.clearSessionCookie(w)
			writeError(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), sessionContextKey, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := auth.ValidateCSRF(sessionFromContext(r.Context()), r.Header.Get("X-CSRF-Token")); err != nil {
			writeError(w, http.StatusForbidden, "Invalid security token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sessionFromContext(ctx context.Context) auth.Session {
	session, _ := ctx.Value(sessionContextKey).(auth.Session)
	return session
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: token, Path: "/", Expires: expiresAt,
		MaxAge: int(time.Until(expiresAt).Seconds()), HttpOnly: true,
		Secure: s.cookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1,
		Expires: time.Unix(1, 0), HttpOnly: true,
		Secure: s.cookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) writeMutationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, securefs.ErrInvalidPath), errors.Is(err, securefs.ErrUnsupportedType), errors.Is(err, documents.ErrInvalidDocument):
		writeError(w, http.StatusBadRequest, "Invalid document")
	case errors.Is(err, os.ErrExist):
		writeError(w, http.StatusConflict, "A document already exists at that path")
	case errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, "Document or parent folder not found")
	default:
		s.logger.Error("document mutation failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to save document")
	}
}

func (s *Server) writeFolderMutationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, securefs.ErrInvalidPath), errors.Is(err, documents.ErrInvalidDocument):
		writeError(w, http.StatusBadRequest, "Invalid folder path")
	case errors.Is(err, os.ErrExist):
		writeError(w, http.StatusConflict, "A file or folder already exists at that path")
	case errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, "Parent folder not found")
	case errors.Is(err, documents.ErrFolderNotEmpty):
		writeError(w, http.StatusConflict, "Folder must be empty before it can be deleted")
	default:
		s.logger.Error("folder mutation failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to update folder")
	}
}

func (s *Server) writeUploadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, securefs.ErrInvalidPath), errors.Is(err, securefs.ErrUnsupportedType), errors.Is(err, documents.ErrInvalidDocument):
		writeError(w, http.StatusBadRequest, "Invalid, unsupported, or oversized upload")
	case errors.Is(err, os.ErrExist):
		writeError(w, http.StatusConflict, "A file with that name already exists")
	case errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, "Document or asset folder not found")
	default:
		s.logger.Error("asset upload failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to upload file")
	}
}

func (s *Server) writeFileError(w http.ResponseWriter, err error, message string) {
	switch {
	case errors.Is(err, securefs.ErrInvalidPath), errors.Is(err, securefs.ErrUnsupportedType):
		writeError(w, http.StatusBadRequest, "Invalid path")
	case errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, message)
	default:
		s.logger.Error("file request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Unable to read requested file")
	}
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		s.logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(started))
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		} else {
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "value", recovered)
				writeError(w, http.StatusInternalServerError, "Internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSONStatus(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	writeJSONStatus(w, status, value)
}

func writeJSONStatus(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write JSON response", "error", err)
	}
}
