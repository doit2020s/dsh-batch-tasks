import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
const out = await build({ entryPoints: ['src/client.jsx'], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022', external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'text' }, jsx: 'automatic', minify: false });
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:"dsh-batch-tasks",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${out.outputFiles[0].text}\nreturn module.exports;}});\n`);
console.log('Built official DSH module-loader client bundle.');
