// Per-task in-memory mutex.
//
// Why: routes that mutate the same AgentTask (/step, /answer, /brief, etc.)
// can be called concurrently for the same taskId — typically when the
// extension's HTTP retry kicks in on a slow response, or when the user
// clicks twice. Concurrent mongoose `task.save()` calls on the same
// document then fail with VersionError ("No matching document found for
// id ... version N") because the second save sees a stale __v.
//
// Serialising the handlers per-taskId eliminates the race entirely.
// This is in-process only — fine because the API runs as a single
// PM2 process. If we ever scale horizontally we'd need a Redis lock.

const locks = new Map(); // taskId -> Promise (tail of the chain)

function withTaskLock(taskId, fn) {
  if (!taskId) return fn();
  const prev = locks.get(taskId) || Promise.resolve();
  // Chain `fn` after whatever is currently running for this task.
  const next = prev.then(fn, fn); // run regardless of prior outcome
  // Store the swallowed-error tail so we don't leak unhandled rejections
  // and so the next caller doesn't inherit a rejected chain.
  const tail = next.catch(() => {});
  locks.set(taskId, tail);
  // Clean up when this is the last waiter.
  tail.finally(() => {
    if (locks.get(taskId) === tail) locks.delete(taskId);
  });
  return next;
}

module.exports = { withTaskLock };
