const { computeScore } = require("../../src/modules/trust-score/trustScore.service");

describe("computeScore", () => {
  it("returns a bounded score", () => {
    const result = computeScore({
      issuerAgeDays: 365,
      totalVerifications: 10,
      successfulVerifications: 9,
      cleanRecentVerifications: 5,
      tamperedDetections: 1,
      revokedDocuments: 0,
      suspiciousAttemptsLast24h: 0,
      totalAttemptsLast24h: 1,
      totalIssuedDocuments: 3
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
