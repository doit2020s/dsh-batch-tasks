/**
 * Account a persisted worker session in the running DSH Host's registry.
 * The Host owns workspace storage and its live domain feed. Writing its JSON
 * file from another process loses updates and never invalidates that cache.
 * The official entity validates the durable session cwd before attaching it.
 */
export async function attachSessionToWorkspace(registry, cwd, sessionId, title) {
  if (!registry || typeof registry.create !== 'function') throw new Error('DSH 工作区服务未就绪，不能登记批量会话');
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.includes('\0')) throw new Error('任务工作目录无效');
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId !== sessionId.trim()) throw new Error('任务会话 ID 无效');
  const workspace = await registry.create(cwd, title || undefined);
  await workspace.attachSession(sessionId);
  return { workspaceId: String(workspace.id), path: workspace.path, sessionId, sessionIds: [...workspace.sessionIds] };
}

/** Official registry operations serialize concurrent calls, including duplicates. */
export async function attachMany(registry, cwd, sessionIds, title) {
  const attached = [];
  for (const id of new Set(sessionIds)) attached.push(await attachSessionToWorkspace(registry, cwd, id, title));
  return attached;
}
