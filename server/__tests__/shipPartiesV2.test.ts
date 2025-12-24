import assert from 'node:assert/strict';
import { buildCandidatePool, buildShipPartiesV2, rolesNeedingAi } from '../shipPartiesV2';

const run = () => {
  const retrievalOk = { status: 'ok' as const, snippets: [] };
  const retrievalEmpty = { status: 'empty' as const, snippets: [] };

  const strong = buildShipPartiesV2({
    input: {
      external: [{ role: 'registeredOwner', name: 'Alpha Shipping', strength: 'strong', confidence: 'high' }],
    },
    retrieval: retrievalOk,
    mode: 'balanced',
    aiStatus: 'skipped',
  });
  assert.equal(strong.parties.registeredOwner?.name, 'Alpha Shipping');
  assert.equal(strong.ai_status, 'skipped');

  const pool = buildCandidatePool({
    external: [{ role: 'registeredOwner', name: 'Alpha Shipping', strength: 'strong', confidence: 'high' }],
  });
  const missing = rolesNeedingAi(pool);
  assert.ok(missing.includes('operator'));

  const emptyBalanced = buildShipPartiesV2({
    input: {},
    retrieval: retrievalEmpty,
    mode: 'balanced',
    aiStatus: 'not_requested',
  });
  assert.equal(emptyBalanced.parties.operator, null);
  assert.equal(emptyBalanced.retrieval_status, 'empty');

  const conflictStrict = buildShipPartiesV2({
    input: {
      external: [
        { role: 'operator', name: 'Alpha Ops', strength: 'strong', confidence: 'high' },
        { role: 'operator', name: 'Beta Ops', strength: 'strong', confidence: 'medium' },
      ],
    },
    retrieval: retrievalOk,
    mode: 'strict',
    aiStatus: 'skipped',
  });
  assert.equal(conflictStrict.parties.operator, null);
  assert.ok(conflictStrict.candidates.operator);
  assert.equal(conflictStrict.candidates.operator?.length, 2);

  const aggressive = buildShipPartiesV2({
    input: {},
    retrieval: retrievalEmpty,
    mode: 'aggressive',
    aiStatus: 'ok',
    aiExtraction: {
      parties: {
        operator: {
          name: 'Gamma Ops',
          status: 'ai_inferred_no_evidence',
          confidence: 'low',
          evidence: [
            {
              source: 'ai',
              path: 'public_evidence.snippets[none]',
              strength: 'none',
            },
          ],
        },
      },
    },
  });
  assert.equal(aggressive.parties.operator?.status, 'ai_inferred_no_evidence');
};

run();
console.log('shipParties v2 tests passed');
