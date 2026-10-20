package serve

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/asano69/cardpod/internal/wikilink"
)

// stageTimer accumulates how long each named stage of a job took, so a slow
// job can be broken down without a profiler. It is safe for concurrent use,
// because the live server shares the same instrumented code paths.
type stageTimer struct {
	mu    sync.Mutex
	total map[string]time.Duration
	count map[string]int
	order []string // stages in order of first use
}

// stages is the single timer shared by the import and the persistence code.
var stages = &stageTimer{
	total: make(map[string]time.Duration),
	count: make(map[string]int),
}

// Let the wikilink package report its own stages into the same timer.
func init() { wikilink.Stage = stages.start }

// start begins timing a stage and returns the function that ends it.
func (t *stageTimer) start(name string) func() {
	begin := time.Now()
	return func() {
		elapsed := time.Since(begin)
		t.mu.Lock()
		defer t.mu.Unlock()
		if _, ok := t.count[name]; !ok {
			t.order = append(t.order, name)
		}
		t.total[name] += elapsed
		t.count[name]++
	}
}

// StageReport returns one line per stage: total time, calls and average.
func StageReport() string {
	stages.mu.Lock()
	defer stages.mu.Unlock()

	var b strings.Builder
	for _, name := range stages.order {
		total, n := stages.total[name], stages.count[name]
		fmt.Fprintf(&b, "%-20s total %10s  calls %7d  avg %10s\n",
			name, total.Round(time.Millisecond), n, (total / time.Duration(n)).Round(time.Microsecond))
	}
	return b.String()
}
