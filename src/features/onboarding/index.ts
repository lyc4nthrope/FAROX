// Superficie pública de la feature onboarding (D3, spec #536 R-D3.* ·
// design #538 §5). El router consume las features por barrel:
// · OnboardingGate = layout route post-RequireAuth (guard derivado + Context);
// · OnboardingPage = la pantalla de /onboarding (pregunta de 2 niveles y sus
//   3 terminales).
export { OnboardingGate } from "./routes/OnboardingGate";
export { OnboardingPage } from "./routes/OnboardingPage";
