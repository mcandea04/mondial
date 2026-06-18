// test/team-code.test.js
// The frontend scoreline tricodes (i18n.js TEAM_CODE, keyed by Romanian name)
// must agree with the canonical FIFA tricodes the pipeline already knows
// (teams.js FIFA_TRICODE_TO_FLAG). The link between them is the flag: a tricode
// and its team's Romanian name must resolve to the same flag-icons code. This
// catches a typo'd or drifted code in either hand-authored table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_CODE } from '../site/assets/i18n.js';
import { fifaTricodeToFlag, flagCode, romanianTeamName, teamNameKeys } from '../pipeline/teams.js';

test('every TEAM_CODE tricode maps to the same flag as its Romanian team', () => {
  for (const [romanianName, tricode] of Object.entries(TEAM_CODE)) {
    const flagFromTricode = fifaTricodeToFlag(tricode);
    assert.ok(flagFromTricode, `tricode ${tricode} (${romanianName}) is unknown to teams.js`);
  }
});

test('TEAM_CODE covers every finalist the pipeline names in Romanian', () => {
  for (const englishName of teamNameKeys()) {
    const romanianName = romanianTeamName(englishName);
    const tricode = TEAM_CODE[romanianName];
    assert.ok(tricode, `no scoreline tricode for ${romanianName} (${englishName})`);
    // the tricode's flag must equal the team's own flag — i.e. the code is the right team's
    assert.equal(fifaTricodeToFlag(tricode), flagCode(englishName),
      `tricode ${tricode} resolves to a different flag than ${romanianName}`);
  }
});
