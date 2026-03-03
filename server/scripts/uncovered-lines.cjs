const data = require('../coverage/coverage-summary.json');
const files = Object.entries(data).filter(([k]) => k !== 'total');
const top = files.map(([f, v]) => ({
  file: f.replace('/Users/yusuke/DeadStockSolution/server/', ''),
  uncovered: v.lines.total - v.lines.covered,
  pct: v.lines.pct,
})).filter(x => x.uncovered > 0 && !x.file.includes('schema.ts')).sort((a, b) => b.uncovered - a.uncovered);

// Show top 15 files
top.slice(0, 15).forEach(x => {
  console.log(x.uncovered + ' uncovered | ' + x.pct + '% | ' + x.file);
});

console.log('\nTotal (excl schema):', top.reduce((s, x) => s + x.uncovered, 0));
