/**
 * Re-export shim — positions logic now lives in the shared EP module.
 * Kept so existing feed routes import paths keep compiling unchanged.
 * @see ../ep/positions
 */
export { getEpPositions as getHyperdashPositions, type MarketPositions, type SmartPosition } from '../ep/positions.js';
