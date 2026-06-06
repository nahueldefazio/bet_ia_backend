/**
 * Expected Value formula:
 *   EV = (p_true * (odd - 1)) - (1 - p_true)
 *   Where p_true is our estimated true probability (0-1)
 *   and odd is the decimal odd offered by the bookmaker.
 *
 * An EV > 0 means the bet has positive expected value (+EV).
 * The implied probability from odds is: p_implied = 1 / odd
 *
 * We also apply Poisson distribution for goal markets and
 * Elo/form-adjusted win probabilities for 1X2 markets.
 */

export function calcExpectedValue(trueProbability: number, odd: number): number {
  return trueProbability * (odd - 1) - (1 - trueProbability);
}

export function impliedProbability(odd: number): number {
  return 1 / odd;
}

/**
 * Remove the bookmaker's margin (vig) from a set of odds to get true market probs.
 * Uses Shin's method for devig: normalizes sum of implied probs to 1.
 */
export function devig(odds: number[]): number[] {
  const sum = odds.reduce((acc, o) => acc + 1 / o, 0);
  return odds.map((o) => 1 / o / sum);
}

/**
 * Poisson distribution: P(X = k) = (lambda^k * e^-lambda) / k!
 */
export function poisson(lambda: number, k: number): number {
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    result *= lambda / i;
  }
  return result;
}

/**
 * Estimate match outcome probabilities using Poisson model.
 * lambda_home = avg goals home team scores * avg goals away team concedes
 * lambda_away = avg goals away team scores * avg goals home team concedes
 *
 * Returns { home: p, draw: p, away: p, btts: p, over25: p }
 */
export function poissonMatchProbabilities(
  homeAvgScored: number,
  homeAvgConceded: number,
  awayAvgScored: number,
  awayAvgConceded: number,
  leagueAvgGoals = 2.7,
): {
  home: number;
  draw: number;
  away: number;
  btts: number;
  over25: number;
} {
  const lambdaHome = (homeAvgScored * awayAvgConceded) / leagueAvgGoals * leagueAvgGoals;
  const lambdaAway = (awayAvgScored * homeAvgConceded) / leagueAvgGoals * leagueAvgGoals;

  const maxGoals = 7;
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let btts = 0;
  let over25 = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poisson(lambdaHome, h) * poisson(lambdaAway, a);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h > 0 && a > 0) btts += p;
      if (h + a > 2) over25 += p;
    }
  }

  return { home: homeWin, draw, away: awayWin, btts, over25 };
}

export function confidenceLevel(ev: number, trueProbability: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (ev >= 0.15 && trueProbability >= 0.55) return 'HIGH';
  if (ev >= 0.07 && trueProbability >= 0.4) return 'MEDIUM';
  return 'LOW';
}

/**
 * Converts Elo ratings to 1X2 probabilities for neutral-venue matches (World Cup).
 * Draw probability scales with match closeness — tighter games draw more often.
 */
export function eloProbabilities(
  eloHome: number,
  eloAway: number,
): { home: number; draw: number; away: number } {
  const dr = (eloHome - eloAway) / 400;
  const pHome = 1 / (1 + Math.pow(10, -dr));
  const pAway = 1 - pHome;

  // International football: ~22-30% draw rate; more draws in close matches
  const closeness = 1 - Math.abs(pHome - 0.5) * 2;
  const drawProb = 0.22 + closeness * 0.08;

  const scale = 1 - drawProb;
  return { home: pHome * scale, draw: drawProb, away: pAway * scale };
}
