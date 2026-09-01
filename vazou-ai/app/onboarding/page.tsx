import { OnboardingForm } from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xl font-bold tracking-tight">
            VAZOU<span className="text-accent">.</span>AI
          </div>
          <p className="mt-1 text-sm text-text-muted">Vamos cadastrar sua empresa.</p>
        </div>
        <OnboardingForm />
      </div>
    </div>
  );
}
