// Simple test script to validate sanitizeBenchmarkPayload
const path = require('path');
const ts = require('typescript');

// Compile the TS file to JS for testing
const tsContent = require('fs').readFileSync(
  path.join(__dirname, 'src', 'lib', 'supabaseUtils.ts'),
  'utf8'
);

const compiled = ts.transpileModule(tsContent, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

// Mock the imports for testing
const mockSanitize = `
// Mock implementations for testing
const safeNumeric = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const cleaned = String(val).replace(/[,₹$€£¥%]/g, '').trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
};

const safeInt = (val, fallback = 0) => {
  const parsed = safeNumeric(val);
  if (parsed === null) return fallback;
  return Math.max(0, Math.min(Math.round(parsed), Number.MAX_SAFE_INTEGER));
};

const getSupabaseAdmin = () => ({});
`;

// Extract just the sanitizeBenchmarkPayload function
const funcMatch = compiled.outputText.match(
  /export async function sanitizeBenchmarkPayload[\s\S]*?\n}\n/
);

const testCode = `
${mockSanitize}
${funcMatch[0]}

(async () => {
  console.log('=== Testing sanitizeBenchmarkPayload ===\\n');

  // Test 1: Currency symbols stripped
  const test1 = await sanitizeBenchmarkPayload({
    creator_handle: '@test1',
    commercial_cost: '$2,500',
    cost_per_view: '0.50',
    reach_efficiency_pct: '120.5',
    performance_tier: 'High Performer',
    content_category: 'Tech',
  });
  console.log('Test 1 - Currency stripping:');
  console.log('  commercial_cost:', test1.commercial_cost, '(expected: 2500)');
  console.log('  cost_per_view:', test1.cost_per_view, '(expected: 0.5)');
  console.log('  reach_efficiency_pct:', test1.reach_efficiency_pct, '(expected: 120.5)');
  console.log('');

  // Test 2: Currency symbols with ₹
  const test2 = await sanitizeBenchmarkPayload({
    creator_handle: '@test2',
    commercial_cost: '₹15,000',
    performance_tier: 'Average',
    content_category: 'Food',
  });
  console.log('Test 2 - INR currency stripping:');
  console.log('  commercial_cost:', test2.commercial_cost, '(expected: 15000)');
  console.log('');

  // Test 3: Missing cost columns - graceful fallback to 0
  const test3 = await sanitizeBenchmarkPayload({
    creator_handle: '@test3',
    cost_per_view: undefined,
    reach_efficiency_pct: undefined,
    performance_tier: 'Flop',
    content_category: 'Travel',
  });
  console.log('Test 3 - Missing cost columns:');
  console.log('  commercial_cost:', test3.commercial_cost, '(expected: 0)');
  console.log('  cost_per_view:', test3.cost_per_view, '(expected: 0)');
  console.log('  reach_efficiency_pct:', test3.reach_efficiency_pct, '(expected: 0)');
  console.log('');

  // Test 4: Invalid/extra keys removed
  const test4 = await sanitizeBenchmarkPayload({
    creator_handle: '@test4',
    performance_tier: 'High Performer',
    content_category: 'Tech',
    invalid_field: 'should be removed',
    another_extra: 123,
  });
  console.log('Test 4 - Invalid fields removed:');
  console.log('  has invalid_field:', 'invalid_field' in test4, '(expected: false)');
  console.log('  has another_extra:', 'another_extra' in test4, '(expected: false)');
  console.log('');

  // Test 5: NaN/undefined values
  const test5 = await sanitizeBenchmarkPayload({
    creator_handle: '@test5',
    commercial_cost: 'not-a-number',
    performance_tier: 'Average',
    content_category: 'Fashion',
  });
  console.log('Test 5 - Invalid cost value:');
  console.log('  commercial_cost:', test5.commercial_cost, '(expected: 0)');
  console.log('');

  console.log('=== All tests completed ===');
})();
`;

require('fs').writeFileSync(path.join(__dirname, 'test-compiled.js'), testCode);

require(path.join(__dirname, 'test-compiled.js'));
