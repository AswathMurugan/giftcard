/**
 * The product name shown to users.
 *
 * Deliberately NOT `APPLICATION.label` from `src/types/app.generated.ts`: that
 * is the platform's label for this app ("Aswath Test App"), the generated file
 * is overwritten by `npm run fetch:application`, and Relay shares that app
 * with Forge — so the platform label cannot distinguish the two.
 *
 * It lives in its own module rather than in `PrivateApp.tsx` because documents
 * that leave the building carry it too, and a brand that reads "Relay" in the
 * chrome but something else on a PDF sent to a buyer is a defect. One
 * constant, one name.
 */
export const APP_BRAND = 'Relay';

/**
 * The strapline beside the mark. Forge reads "Card Production"; this is the
 * supplier's half of the same process, so it says whose surface it is.
 */
export const APP_TAGLINE = 'Supplier Portal';
