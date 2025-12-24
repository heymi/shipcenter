import assert from 'node:assert/strict';
import { aiOutputToCandidates, buildShipPartiesResponse, validateShipPartiesResponse } from '../shipParties';

const run = () => {
  const empty = buildShipPartiesResponse({ imo: '1234567' });
  assert.equal(empty.registeredOwner, null);
  assert.equal(empty.beneficialOwner, null);
  assert.equal(empty.operator, null);
  assert.equal(empty.manager, null);
  assert.ok(validateShipPartiesResponse(empty));

  const aisOnly = buildShipPartiesResponse({
    aisStatic: { registeredOwner: 'Alpha Shipping' },
  });
  assert.equal(aisOnly.registeredOwner?.value, 'Alpha Shipping');
  assert.equal(aisOnly.registeredOwner?.confidence, 'medium');
  assert.ok(!aisOnly.candidates.registeredOwner);
  assert.ok(validateShipPartiesResponse(aisOnly));

  const conflict = buildShipPartiesResponse({
    aisStatic: { registeredOwner: 'Alpha Shipping' },
    external: [
      { field: 'registeredOwner', value: 'Beta Shipping', confidence: 'high', path: 'external[0].value' },
    ],
  });
  assert.equal(conflict.registeredOwner, null);
  assert.ok(conflict.candidates.registeredOwner);
  assert.equal(conflict.candidates.registeredOwner?.length, 2);

  const mergeSame = buildShipPartiesResponse({
    aisStatic: { registeredOwner: 'Alpha Shipping' },
    external: [
      { field: 'registeredOwner', value: 'Alpha Shipping', confidence: 'low', path: 'external[0].value' },
    ],
  });
  assert.equal(mergeSame.registeredOwner?.value, 'Alpha Shipping');
  assert.equal(mergeSame.registeredOwner?.confidence, 'medium');
  assert.equal(mergeSame.registeredOwner?.evidence.length, 2);
  assert.ok(validateShipPartiesResponse(mergeSame));

  const aiCandidates = aiOutputToCandidates({
    registeredOwner: {
      value: 'Gamma Shipping',
      confidence: 'high',
      evidence: [{ source: 'external', path: 'sources[0].url' }],
    },
    beneficialOwner: null,
    operator: null,
    manager: null,
    candidates: {
      registeredOwner: [
        {
          value: 'Delta Shipping',
          confidence: 'medium',
          evidence: [{ source: 'external', path: 'sources[1].snippet' }],
        },
      ],
    },
  });
  const aiMerged = buildShipPartiesResponse({ imo: '1234567' }, aiCandidates);
  assert.equal(aiMerged.registeredOwner, null);
  assert.ok(aiMerged.candidates.registeredOwner);
  assert.equal(aiMerged.candidates.registeredOwner?.length, 2);
  aiMerged.ai_status = 'ok';
  assert.ok(validateShipPartiesResponse(aiMerged));
};

run();
console.log('shipParties tests passed');
