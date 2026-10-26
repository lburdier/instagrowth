// Publie la version courante sur GitHub (release « desktop-vX.Y.Z », non marquée
// « Latest » pour ne pas masquer les releases de l'extension). Les apps installées
// la verront à leur prochaine vérification et proposeront la mise à jour.
//   1. monte "version" dans package.json et commite   2. npm run dist   3. git push   4. npm run release -- "Notes de version"

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version, build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const setup = `InstaGrowth-Desktop-Setup-${version}.exe`;
const files = [setup, `${setup}.blockmap`, 'latest.yml'].map((f) => path.join(dist, f));
const missing = files.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error(`Fichiers manquants (lance d'abord « npm run dist ») :\n${missing.join('\n')}`);
  process.exit(1);
}
const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
if (!yml.includes(`version: ${version}`)) {
  console.error(`dist/latest.yml ne correspond pas à la version ${version} : relance « npm run dist ».`);
  process.exit(1);
}
const tag = `desktop-v${version}`;
// Le tag pointe sur le commit courant (qui doit déjà être poussé), pas sur la branche par défaut.
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const notes = process.argv.slice(2).join(' ') || `InstaGrowth Desktop ${version}`;
execFileSync('gh', ['release', 'create', tag, ...files, '--repo', 'lburdier/instagrowth', '--title', `${build.productName} ${version}`, '--notes', notes, '--target', sha, '--latest=false'], { stdio: 'inherit' });
console.log(`Release ${tag} publiée.`);
