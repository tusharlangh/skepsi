package sim

import (
	"testing"
)

const benchmarkSeed int64 = 12345

func assertConvergenceB(b *testing.B, clients []*Client, expectedLen int) {
	b.Helper()
	if len(clients) == 0 {
		return
	}
	ref := clients[0].Document()
	for i, c := range clients {
		if s := c.Document(); s != ref {
			b.Fatalf("client %d (%s) diverged: got %q, expected %q", i, c.SiteId, s, ref)
		}
	}
	if expectedLen >= 0 && len(ref) != expectedLen {
		b.Fatalf("document length: got %d, expected %d; doc = %q", len(ref), expectedLen, ref)
	}
}

func siteIdFor(i int) string {
	if i < 26 {
		return string(rune('A' + i))
	}
	return string(rune('A'+(i/26)-1)) + string(rune('a'+(i%26)))
}

func runChaosConvergence(b *testing.B, numClients, numOps int) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		config := DefaultChaosConfig(benchmarkSeed + int64(i))
		net := NewNetwork(config)
		clients := make([]*Client, numClients)
		for j := 0; j < numClients; j++ {
			clients[j] = NewClient(siteIdFor(j), j*100)
		}

		left := clients[0].Left()
		right := clients[0].Right()
		for k := 0; k < numOps; k++ {
			c := clients[k%numClients]
			r := rune('a' + (k % 26))
			op := c.LocalInsert(left, right, r)
			net.Send(op, c.SiteId)
			pos := c.Positions()
			if len(pos) > 0 {
				left = pos[len(pos)-1]
			}
		}

		net.DeliverAll(clients)
		assertConvergenceB(b, clients, numOps)
	}
	b.StopTimer()

	// Report ops delivered per second (each iteration delivers numOps to numClients replicas)
	totalOpsDelivered := int64(b.N) * int64(numOps) * int64(numClients)
	b.ReportMetric(float64(totalOpsDelivered)/b.Elapsed().Seconds(), "ops_delivered/sec")
	// Convergence time: average ms per full convergence run (setup + DeliverAll)
	b.ReportMetric(float64(b.Elapsed().Milliseconds())/float64(b.N), "convergence_ms")
}

func BenchmarkConvergence10Clients1000Ops(b *testing.B) {
	runChaosConvergence(b, 10, 1000)
}

func BenchmarkConvergence20Clients500Ops(b *testing.B) {
	runChaosConvergence(b, 20, 500)
}
