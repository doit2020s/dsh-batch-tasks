import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function presetPatchPath(workDir) {
  return join(workDir, '.dsh-batch-preset.patch.yml');
}

/** Extend the official SDK composition for one selected Agent preset. */
export async function writePresetPatch(workDir, agentPreset) {
  const serverUrl = new URL('./preset-server.js', import.meta.url).href;
  // Match the official Web/Desktop host-agent split: these default agent
  // contributions move into the selected preset, while host registries stay.
  const agentRows = [
    'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
    'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal',
    'plan-mode', 'compaction-basic', 'command-compact', 'tool-result-pruner',
    'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent',
    'tool-subagent-fork', 'workflow-worker-thread', 'tool-workflow',
    'tool-ralph', 'agent-instructions', 'tool-todo', 'tool-web',
  ];
  const content = [
    '- id: sdk-jsonrpc-server',
    '  disabled: true',
    ...agentRows.flatMap(id => [`- id: ${id}`, '  disabled: true']),
    '- insert:',
    '    - id: subagent-model-selection-settings',
    "      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'",
    '    - id: agent-presets',
    "      name: '@deepseek-ai/dsh-agent-presets'",
    '      config:',
    `        default: ${JSON.stringify(agentPreset)}`,
    '    - id: batch-preset-jsonrpc-server',
    `      name: ${JSON.stringify(serverUrl)}`,
    '      inject:',
    '        - sdkAppStartup',
    '        - loader',
    '',
  ].join('\n');
  const path = presetPatchPath(workDir);
  await writeFile(path, content, 'utf8');
  return path;
}
