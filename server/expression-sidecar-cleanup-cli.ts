// One-time command: preview first, then apply only the exact reviewed plan.
import { applySidecarCleanup, planSidecarCleanup } from './expression-sidecar-cleanup.js';
import type { DuplicateScorePolicy } from './expression-sidecar-merge.js';

const [mode, photo = '', oldStem = '', policy = 'first', token = ''] = process.argv.slice(2);
const aliases: Record<string, string> = photo && oldStem ? { [photo]: oldStem } : {};
if (mode === 'preview') {
  const plan = planSidecarCleanup(aliases, policy as DuplicateScorePolicy);
  process.stdout.write(JSON.stringify({ token: plan.token, photos: plan.rows.length, skipped: plan.skipped, sourceFiles: plan.rows.reduce((n, row) => n + row.sources.length, 0), modelFilesToArchive: plan.rows.reduce((n, row) => n + row.sources.filter(source => source.rel.toLowerCase() !== row.destination.toLowerCase()).length, 0), withoutGpt: plan.rows.filter(row => !row.hasGpt).map(row => row.photo), withoutSonnet: plan.rows.filter(row => !row.hasSonnet).map(row => row.photo) }, null, 2));
} else if (mode === 'apply' && token) {
  process.stdout.write(JSON.stringify(applySidecarCleanup(aliases, token, policy as DuplicateScorePolicy), null, 2));
} else throw new Error('Use preview <photo-path> <old-stem> <first|higher|review>, then apply the same arguments and the preview token.');
