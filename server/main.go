package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed web
var embedded embed.FS

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	store, err := Open(env("DATA_DIR", "/data"))
	if err != nil {
		log.Fatal(err)
	}
	web, err := fs.Sub(embedded, "web")
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{
		Addr:              env("ADDR", ":8080"),
		Handler:           newHandler(store, web),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		// docker stop sends SIGKILL after 10s; stay well under it.
		sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()

	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
