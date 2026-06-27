/**
 * Re-export shim — cohort sentiment logic now lives in the shared EP module.
 * Kept so existing feed routes import paths keep compiling unchanged.
 * @see ../ep/sentiment
 */
export {
  getCohortSentiment,
  biasFor,
  type CohortBias,
  type MarketSentiment,
  type CohortMarketSentiment,
  type CohortSummary,
  type CohortFeed,
} from '../ep/sentiment.js';
