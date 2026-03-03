const data = require('../coverage/coverage-summary.json');
const files = Object.entries(data).filter(([k]) => k !== 'total');
const uncovered = files.map(([f, v]) => ({
  file: f.replace('/Users/yusuke/DeadStockSolution/server/', ''),
  total: v.lines.total,
  covered: v.lines.covered,
  uncovered: v.lines.total - v.lines.covered,
  pct: v.lines.pct,
})).filter(x => x.uncovered > 0).sort((a, b) => b.uncovered - a.uncovered);
console.log('Total uncovered lines:', uncovered.reduce((s, x) => s + x.uncovered, 0));
console.log('Need to cover for 95%:', Math.ceil(data.total.lines.total * 0.95) - data.total.lines.covered);
console.log();
uncovered.slice(0, 30).forEach(x => console.log(String(x.uncovered).padStart(3) + ' | ' + String(x.pct).padStart(6) + '% | ' + x.file));
