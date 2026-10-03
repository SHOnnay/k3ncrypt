/**
 * Optional message transports remain disabled in production. This is an
 * explicit local build gate, not user consent or peer capability negotiation.
 */
export const CONNECTIVITY_FEATURE_FLAGS = Object.freeze({
    lanDelivery: false,
    directDelivery: false,
});
