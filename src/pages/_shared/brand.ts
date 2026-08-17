/**
 * The product name shown to users.
 *
 * Deliberately NOT `APPLICATION.label` from `src/types/app.generated.ts`: that
 * is the platform's label for this app ("Aswath Test App"), the generated file
 * is overwritten by `npm run fetch:application`, and renaming the app on the
 * platform would change it for every other consumer of the tenant.
 *
 * It lives in its own module rather than in `PrivateApp.tsx` because documents
 * that leave the building carry it too (the supplier spec sheet), and a brand
 * that reads "Forge" in the chrome but "Aswath Test App" on the PDF sent to a
 * supplier is a defect. One constant, one name.
 */
export const APP_BRAND = 'Forge';
