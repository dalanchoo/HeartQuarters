/**
 * Migrate packaging markdown files (YouTube.md, TikTok.md, Instagram.md, Substack.md, LinkedIn.md)
 * from legacy "Title:" / "PINNED COMMENT" labels to standard Markdown "## Title" / "## Pinned Comment" headings.
 *
 * Dry-run by default:
 *   npx tsx scripts/migrate-packaging-markdown.ts "C:\path\to\copy"
 *
 * Write changes:
 *   npx tsx scripts/migrate-packaging-markdown.ts "C:\path\to\copy" --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { migratePackagingText } from '../web/src/packaging.js';

const SKIP_DIRS = new Set(['Exports', 'Intermediate', 'Proxy', 'Clips', 'Raw', 'Claude', 'Thumbnail', 'Drafts']);
const PLATFORM_MD_RE = /^(youtube|tiktok|instagram|substack|linkedin).*\.md$/i;
const VERSION_DIR_RE = /[\\/]Packaging[\\/](?:V\d+.*|D\d+.*|Legacy)$/i;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && VERSION_DIR_RE.test(dir) && PLATFORM_MD_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = args.find((a) => !a.startsWith('--'));
if (!root || !fs.existsSync(root)) {
  console.error('Usage: npx tsx scripts/migrate-packaging-markdown.ts <folder> [--apply]');
  process.exit(1);
}

const files: string[] = [];
walk(path.resolve(root), files);

let changed = 0;
let unchanged = 0;
const skipped: string[] = [];
const errors: string[] = [];

for (const file of files) {
  try {
    const before = fs.readFileSync(file, 'utf8');
    const after = migratePackagingText(before);
    if (after !== before) {
      changed++;
      if (apply) fs.writeFileSync(file, after, 'utf8');
    } else {
      unchanged++;
      if (!/^##\s+/m.test(before)) skipped.push(path.relative(root, file));
    }
  } catch (err) {
    errors.push(`${path.relative(root, file)}: ${(err as Error).message}`);
  }
}

console.log(`${apply ? 'Applied' : 'Dry run'} on ${files.length} packaging files:`);
console.log(`  ${apply ? 'Updated' : 'Would update'}: ${changed}`);
console.log(`  Already ## or unchanged: ${unchanged - skipped.length}`);
console.log(`  Non-labelled / skipped: ${skipped.length}`);
if (skipped.length) {
  console.log('  Sample skipped files:');
  for (const s of skipped.slice(0, 10)) console.log(`    - ${s}`);
}
if (errors.length) {
  console.error(`  Errors (${errors.length}):`);
  for (const e of errors) console.error(`    - ${e}`);
  process.exit(1);
}
