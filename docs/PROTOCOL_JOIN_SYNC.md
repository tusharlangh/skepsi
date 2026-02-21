# JOIN → SYNC protocol decisions

## Why forward join to one peer only

- Server does not store history. Only a peer can stream ops.
- Broadcasting join to all peers would cause N sync streams to the same joiner and duplicate ops; the joiner would need to dedupe and merge. Sending to one peer keeps one canonical stream per join, deterministic and simple.
- Random peer selection spreads load and avoids a single point of failure; any peer with the doc can serve.

## Why targeted sync_op / sync_done (not broadcast)

- sync_op and sync_done are directed at the joining site only. The server routes by `target` (siteId) so only that connection receives the stream. Other peers never see these messages and do not replay them.

## Why buffer until sync_done

- Messages may arrive out of order. The joiner buffers all sync_op messages and replays in arrival order when sync_done is received. That gives a well-defined “sync window” and avoids applying a partial history.

## Idempotency and duplicates

- Ops are keyed by (site, counter). The client log tracks applied opIds and skips already-applied ops. Duplicate sync_op or retransmitted ops do not change state.

## Server never persists

- The server only adds the client to the room, forwards the join to one peer, and routes sync_op/sync_done to the target connection. No storage or aggregation.
