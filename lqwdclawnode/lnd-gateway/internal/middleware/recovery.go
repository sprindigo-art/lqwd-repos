package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recovery returns middleware that catches panics and returns 500 instead of crashing.
func Recovery(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					logger.Error("panic recovered",
						"error", err,
						"path", r.URL.Path,
						"stack", string(debug.Stack()),
					)
					WriteJSON(w, http.StatusInternalServerError, map[string]any{
						"ok":    false,
						"error": "internal_error",
					})
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
