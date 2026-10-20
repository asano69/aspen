// Package config loads the configuration for cardpod serve from
// environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
)

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Host string
	Port int
}

type Config struct {
	Server ServerConfig
}

// Load reads configuration from environment variables, applying defaults
// for any variable that is unset.
//
// Recognised variables:
//
//	CARDPOD_SERVER_HOST         default "0.0.0.0"
//	CARDPOD_SERVER_PORT         default 3000
func Load() (*Config, error) {
	port, err := envInt("CARDPOD_SERVER_PORT", 3000)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Server: ServerConfig{
			Host: envString("CARDPOD_SERVER_HOST", "0.0.0.0"),
			Port: port,
		},
	}
	return cfg, nil
}

// envString returns the value of the environment variable key, or fallback
// if it is unset or empty.
func envString(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

// envInt returns the integer value of the environment variable key, or
// fallback if it is unset.
func envInt(key string, fallback int) (int, error) {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return n, nil
}
