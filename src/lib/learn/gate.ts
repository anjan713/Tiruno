// Learn-section unlock rule, isolated as a pure function (SRP) so the Learn page, the
// nav, and the profile all derive "is Learn unlocked?" from one place. The learner must
// finish profile setup first: a name, at least 3 articles of interest (links), and at
// least 3 keywords of interest. The articles themselves are read inside Learn afterwards.

export const LEARN_MIN_ARTICLES = 3;
export const LEARN_MIN_KEYWORDS = 3;

export interface LearnGateState {
  name: string;
  interestArticleIds: string[];
  interestKeywords: string[];
}

export interface LearnGate {
  unlocked: boolean;
  hasName: boolean;
  articlesAdded: number;
  keywordsAdded: number;
  /** Remaining articles/keywords still needed (0 once satisfied). */
  articlesRemaining: number;
  keywordsRemaining: number;
}

export function learnGate(s: LearnGateState): LearnGate {
  const hasName = s.name.trim().length > 0;
  const articlesAdded = s.interestArticleIds.length;
  const keywordsAdded = s.interestKeywords.length;
  const articlesRemaining = Math.max(0, LEARN_MIN_ARTICLES - articlesAdded);
  const keywordsRemaining = Math.max(0, LEARN_MIN_KEYWORDS - keywordsAdded);
  return {
    unlocked: hasName && articlesRemaining === 0 && keywordsRemaining === 0,
    hasName,
    articlesAdded,
    keywordsAdded,
    articlesRemaining,
    keywordsRemaining,
  };
}
