/**
 * @file Pre-commit hook для Rust файлов (cargo fmt + clippy)
 * Проверяет только изменённые .rs файлы через git diff
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CARGOS = [
  { manifest: 'server/Cargo.toml', label: 'server' },
  { manifest: 'src-tauri/Cargo.toml', label: 'src-tauri' },
];

/**
 * Получить список изменённых .rs файлов
 */
function getChangedRsFiles() {
  try {
    // Staged files
    const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    return staged
      .split('\n')
      .filter((f) => f.trim().endsWith('.rs'))
      .map((f) => f.trim());
  } catch {
    return [];
  }
}

/**
 * Определить какие Cargo.toml затронуты изменёнными файлами
 */
function getAffectedCrates(changedFiles) {
  const affected = new Set();

  for (const file of changedFiles) {
    for (const cargo of CARGOS) {
      const cargoDir = cargo.manifest.replace('/Cargo.toml', '');
      if (file.startsWith(cargoDir + '/') || file.startsWith(cargoDir + '\\')) {
        affected.add(cargo);
        break;
      }
    }
  }

  return [...affected];
}

/**
 * Запустить cargo fmt + clippy для конкретной crates
 */
function runCargoChecks(cargo) {
  const manifest = cargo.manifest;
  const label = cargo.label;

  console.log(`\n🔧 Проверка Rust crate: ${label} (${manifest})`);

  // 1. cargo fmt (auto-fix)
  console.log(`  📝 cargo fmt --manifest-path ${manifest}`);
  try {
    execSync(`cargo fmt --manifest-path ${manifest}`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error(`❌ cargo fmt failed для ${label}:`, e.message);
    process.exit(1);
  }

  // 2. cargo clippy (check only, no auto-fix)
  console.log(`  🔍 cargo clippy --manifest-path ${manifest}`);
  try {
    execSync(
      `cargo clippy --manifest-path ${manifest} -- -D warnings`,
      {
        cwd: ROOT,
        stdio: 'inherit',
      }
    );
  } catch (e) {
    console.error(`❌ cargo clippy failed для ${label}:`, e.message);
    console.error('\n💡 Исправьте ошибки clippy перед коммитом');
    process.exit(1);
  }

  console.log(`  ✅ ${label} — ok`);
}

// Main
const changedFiles = getChangedRsFiles();
if (changedFiles.length === 0) {
  console.log('✅ Нет изменённых .rs файлов — skip Rust checks');
  process.exit(0);
}

console.log(`📋 Изменённые .rs файлы: ${changedFiles.length}`);
changedFiles.forEach((f) => console.log(`  - ${f}`));

const affectedCrates = getAffectedCrates(changedFiles);
if (affectedCrates.length === 0) {
  console.log('⚠️  Не удалось определить crate — skip Rust checks');
  process.exit(0);
}

console.log(`📦 Затронутые crates: ${affectedCrates.map((c) => c.label).join(', ')}`);

for (const cargo of affectedCrates) {
  runCargoChecks(cargo);
}

console.log('\n✅ Все Rust проверки пройдены');
