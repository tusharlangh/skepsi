/**
 * Example: when creating CollabNetwork, pass onJoinRequest so the peer streams
 * its op log to the joining client, then sends sync_done.
 *
 * const network = new CollabNetwork({
 *   url: "ws://localhost:8080/ws",
 *   docId: "doc1",
 *   siteId: mySiteId,
 *   onApplyOp: (op) => { ... },
 *   onJoinRequest: (join) => {
 *     for (const op of network.getOpLog()) {
 *       network.sendSyncOp(join.siteId, op);
 *     }
 *     network.sendSyncDone(join.siteId);
 *   },
 * });
 * network.setApplyOp(applyOp);
 * network.connect();
 */
export {};
