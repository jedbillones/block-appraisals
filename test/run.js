// Local harness: runs a fixture through Zap steps 2 and 3 the way Zapier does.
// Zapier Code steps read a bare `inputData` and (step 3) assign a bare
// `output`, so each file is evaluated in a vm context supplying those.
//
//   node test/run.js                              # all fixtures, all fields
//   node test/run.js 01                            # one fixture
//   node test/run.js 01 capproachlist cappraisaldate   # selected fields

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const parseSrc = fs.readFileSync(path.join(ROOT, 'zapier/02-parse-webhook.js'), 'utf8');
const buildSrc = fs.readFileSync(path.join(ROOT, 'zapier/03-copybuilder.js'), 'utf8');

function runParse(rawBody) {
  const ctx = vm.createContext({ inputData: { body: rawBody }, JSON, String });
  // The step ends in a top-level `return`, legal only inside a function.
  return vm.runInContext('(function () {\n' + parseSrc + '\n})()', ctx);
}

function runBuild(fields) {
  const ctx = vm.createContext({
    inputData: { body: JSON.stringify(fields) },
    JSON, String, Object, Math, Intl, Date, parseInt, parseFloat
  });
  vm.runInContext(buildSrc, ctx);
  return ctx.output;
}

const [wanted, ...fieldFilter] = process.argv.slice(2);

fs.readdirSync(path.join(ROOT, 'fixtures'))
  .filter(f => f.endsWith('.json'))
  .filter(f => !wanted || f.startsWith(wanted))
  .forEach(file => {
    const raw = fs.readFileSync(path.join(ROOT, 'fixtures', file), 'utf8');
    const out = runBuild(runParse(raw));
    console.log('\n' + '='.repeat(70) + '\n' + file + '\n' + '='.repeat(70));
    Object.keys(out)
      .filter(k => fieldFilter.length === 0 || fieldFilter.indexOf(k) !== -1)
      .forEach(k => console.log('\n--- ' + k + ' ---\n' + out[k]));
  });
