import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The external picker reads display metadata only, never Agent composition or prompts. */
export function agentPresetPackage(runtime) {
  return dirname(createRequire(runtime.dshBin).resolve('@deepseek-ai/dsh-agent-presets/package.json'));
}

export function selectedAgentPreset(settings = {}) {
  const modern = settings['agent-preset-registry']?.selectedDefault;
  const legacy = settings['agent-presets']?.default;
  return typeof modern === 'string' && modern.trim() ? modern.trim()
    : typeof legacy === 'string' && legacy.trim() ? legacy.trim() : 'standard';
}

/** Mirror Harness's shipped-first root precedence using path-free roster rows. */
export function scanAgentPresetRoots(roots, readYaml, defaultId) {
  const seen = new Set(), presets = [];
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    for (const id of readdirSync(root.path).sort()) {
      if (seen.has(id) || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) continue;
      const dir = join(root.path, id);
      if (!statSync(dir).isDirectory()) continue;
      seen.add(id);
      // Checking the entry point exists does not read or evaluate its contents.
      const composition = join(dir, 'agent.cordis.yml');
      const broken = !existsSync(composition) || !statSync(composition).isFile() ? '缺少 agent.cordis.yml' : '';
      let metadata = {};
      try { metadata = readYaml(join(dir, 'preset.yml')) || {}; } catch {}
      const name = typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : id;
      const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
      const order = typeof metadata.order === 'number' && Number.isFinite(metadata.order) ? metadata.order : Number.MAX_SAFE_INTEGER;
      presets.push({ id, name, description, trust: root.trust, broken, isDefault: id === defaultId, order });
    }
  }
  return presets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function readAgentPresetRoster(runtime) {
  const packageRoot = agentPresetPackage(runtime);
  // Use the selected Harness's YAML parser rather than a second runtime dependency.
  const yaml = createRequire(join(packageRoot, 'package.json'))('js-yaml');
  const readYaml = path => yaml.load(readFileSync(path, 'utf8'));
  let settings = {};
  try { settings = readYaml(join(runtime.home, 'settings.yaml')) || {}; } catch {}
  const defaultAgentPreset = selectedAgentPreset(settings);
  const presets = scanAgentPresetRoots([
    { path: join(packageRoot, 'presets'), trust: 'system' },
    { path: join(runtime.home, '.agent-presets'), trust: 'user' },
  ], readYaml, defaultAgentPreset);
  return { presets, defaultAgentPreset };
}
